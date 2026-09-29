import { Injectable } from '@angular/core';
import {
  Firestore,
  Unsubscribe,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
} from 'firebase/firestore';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../environments/environment';
import { CatalogProduct, InventoryItem } from '../models/inventory-item';

const COLLECTION_NAME = 'inventoryItems';

@Injectable({ providedIn: 'root' })
export class InventoryRepository {
  private readonly db: Firestore | null;

  constructor() {
    this.db = this.hasFirebaseConfiguration()
      ? getFirestore(getApps().length ? getApp() : initializeApp(environment.firebase))
      : null;
  }

  isAvailable(): boolean {
    return this.db !== null;
  }

  configurationMessage(): string {
    return 'src/environments/environment.ts に Firebase の Web 設定を入力してください。';
  }

  watch(next: (items: InventoryItem[]) => void, onError: (error: Error) => void): Unsubscribe {
    if (!this.db) {
      onError(new Error(this.configurationMessage()));
      return () => undefined;
    }

    const itemsQuery = query(collection(this.db, COLLECTION_NAME), orderBy('updatedAt', 'desc'));

    return onSnapshot(
      itemsQuery,
      (snapshot) => {
        next(snapshot.docs.map((item) => item.data() as InventoryItem));
      },
      (error) => onError(error),
    );
  }

  async registerCatalogProduct(product: CatalogProduct): Promise<boolean> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, product.barcode);
    const now = new Date().toISOString();

    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) return false;
      const next: InventoryItem = {
        barcode: product.barcode,
        name: product.name,
        quantity: 0,
        unitPrice: product.unitPrice,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        source: 'yahoo-shopping',
        brand: product.brand,
        storeName: product.storeName,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(reference, next);
      return true;
    });
  }

  async registerManualProduct(
    barcode: string,
    name: string,
    unitPrice: number | null,
  ): Promise<boolean> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, barcode);
    const now = new Date().toISOString();

    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) return false;
      transaction.set(reference, {
        barcode,
        name,
        quantity: 0,
        unitPrice,
        imageUrl: '',
        productUrl: '',
        source: 'manual',
        brand: '',
        storeName: '',
        createdAt: now,
        updatedAt: now,
      } satisfies InventoryItem);
      return true;
    });
  }

  async changeQuantity(barcode: string, difference: number): Promise<void> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, barcode);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) {
        throw new Error('対象の商品が見つかりません。');
      }
      const item = snapshot.data() as InventoryItem;
      transaction.update(reference, {
        quantity: Math.max(0, (item.quantity ?? 0) + difference),
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async deleteProduct(barcode: string): Promise<void> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, barcode);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error('削除する商品が見つかりません。');
      transaction.delete(reference);
    });
  }

  private hasFirebaseConfiguration(): boolean {
    const { apiKey, appId, projectId } = environment.firebase;
    return Boolean(apiKey && appId && projectId);
  }

  private requireDatabase(): Firestore {
    if (!this.db) {
      throw new Error(this.configurationMessage());
    }
    return this.db;
  }
}
