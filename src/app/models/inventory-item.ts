export interface InventoryItem {
  barcode: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  imageUrl: string;
  productUrl: string;
  source: 'yahoo-shopping' | 'manual' | 'csv';
  brand: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProduct {
  barcode: string;
  name: string;
  unitPrice: number | null;
  imageUrl: string;
  productUrl: string;
  brand: string;
  storeName: string;
}

export type CsvOperation = 'set' | 'add' | 'subtract';

export interface CsvInventoryRow {
  barcode: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  operation: CsvOperation;
  brand: string;
  storeName: string;
  productUrl: string;
}
