import { Injectable } from '@angular/core';
import {
  Firestore,
  Unsubscribe,
  collection,
  doc,
  getDoc,
  getFirestore,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  writeBatch,
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

  watch(next: (items: InventoryItem[], fromServer: boolean) => void, onError: (error: Error) => void): Unsubscribe {
    if (!this.db) {
      onError(new Error(this.configurationMessage()));
      return () => undefined;
    }

    const itemsQuery = query(collection(this.db, COLLECTION_NAME), orderBy('updatedAt', 'desc'));

    return onSnapshot(
      itemsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        next(
          snapshot.docs.map((item) => item.data() as InventoryItem),
          !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites,
        );
      },
      (error) => onError(error),
    );
  }

  async refresh(): Promise<InventoryItem[]> {
    const db = this.requireDatabase();
    const itemsQuery = query(collection(db, COLLECTION_NAME), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocsFromServer(itemsQuery);
    return snapshot.docs.map((item) => item.data() as InventoryItem);
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

  async registerProduct(
    product: ProductDetails,
    quantity: number,
    now = new Date().toISOString(),
    masterName?: string,
  ): Promise<boolean> {
    const db = this.requireDatabase();
    const reference = doc(db, COLLECTION_NAME, product.barcode);
    const masterReference = doc(db, MASTER_COLLECTION, product.barcode);
    const next: InventoryItem = { ...product, quantity, createdAt: now, updatedAt: now };
    const batch = writeBatch(db);
    if (masterName === undefined) {
      batch.set(masterReference, { ...product, createdAt: now } satisfies ProductMaster);
    } else if (masterName !== product.name) {
      batch.update(masterReference, { name: product.name });
    }
    batch.set(reference, next);
    try {
      await batch.commit();
      return true;
    } catch (error) {
      // A concurrent registration is rejected by the create-only inventory rule.
      // Check the document only on failure so the usual path needs one write round trip.
      try {
        if ((await getDoc(reference)).exists()) return false;
      } catch {
        // Preserve the original write error when the follow-up read is unavailable.
      }
      throw error;
    }
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
    // Every registration writes its master atomically. Removing only the inventory
    // document keeps that master available for a later registration.
    await writeBatch(db).delete(reference).commit();
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
