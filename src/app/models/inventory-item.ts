export interface InventoryItem {
  barcode: string;
  name: string;
  quantity: number;
  imageUrl: string;
  productUrl: string;
  source: 'yahoo-shopping' | 'manual';
  brand: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProduct {
  barcode: string;
  name: string;
  imageUrl: string;
  productUrl: string;
  brand: string;
  storeName: string;
}
