import { Injectable } from '@angular/core';
import {
  Firestore,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
} from 'firebase/firestore';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { environment } from '../../environments/environment';
import { InventoryItem, ProductDetails, ProductMaster } from '../models/inventory-item';

const COLLECTION_NAME = 'inventoryItems';
const MASTER_COLLECTION = 'productMasters';

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

  async getInventoryItem(barcode: string): Promise<InventoryItem | null> {
    const db = this.requireDatabase();
    const snapshot = await getDoc(doc(db, COLLECTION_NAME, barcode));
    return snapshot.exists() ? snapshot.data() as InventoryItem : null;
  }

  async getMasterProduct(barcode: string): Promise<ProductMaster | null> {
    const db = this.requireDatabase();
    const snapshot = await getDoc(doc(db, MASTER_COLLECTION, barcode));
    return snapshot.exists() ? snapshot.data() as ProductMaster : null;
  }

  async registerProduct(product: ProductDetails, quantity: number, now = new Date().toISOString()): Promise<boolean> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, product.barcode);
    const masterReference = doc(db, MASTER_COLLECTION, product.barcode);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) return false;
      const masterSnapshot = await transaction.get(masterReference);
      const next: InventoryItem = {
        barcode: product.barcode,
        name: product.name,
        quantity,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        source: product.source,
        brand: product.brand,
        storeName: product.storeName,
        createdAt: now,
        updatedAt: now,
      };
      if (!masterSnapshot.exists()) {
        transaction.set(masterReference, { ...product, createdAt: now } satisfies ProductMaster);
      } else if ((masterSnapshot.data() as ProductMaster).name !== product.name) {
        transaction.update(masterReference, { name: product.name });
      }
      transaction.set(reference, next);
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

  async setQuantity(barcode: string, quantity: number, updatedAt = new Date().toISOString()): Promise<void> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, barcode);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error('対象の商品が見つかりません。');
      transaction.update(reference, { quantity, updatedAt });
    });
  }

  async deleteProduct(barcode: string): Promise<void> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, barcode);
    const masterReference = doc(db, MASTER_COLLECTION, barcode);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error('削除する商品が見つかりません。');
      const masterSnapshot = await transaction.get(masterReference);
      if (!masterSnapshot.exists()) {
        const item = snapshot.data() as InventoryItem;
        const { barcode: itemBarcode, name, imageUrl, productUrl, source, brand, storeName } = item;
        transaction.set(masterReference, {
          barcode: itemBarcode,
          name,
          imageUrl: imageUrl ?? '',
          productUrl: productUrl ?? '',
          source: source ?? 'manual',
          brand: brand ?? '',
          storeName: storeName ?? '',
          createdAt: item.createdAt ?? new Date().toISOString(),
        } satisfies ProductMaster);
      }
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
