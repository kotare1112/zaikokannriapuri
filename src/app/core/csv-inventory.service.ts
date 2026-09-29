import { Injectable } from '@angular/core';
import { CsvInventoryRow, CsvOperation, InventoryItem } from '../models/inventory-item';

const HEADER_ALIASES: Record<string, string[]> = {
  barcode: ['barcode', 'jan', 'バーコード', 'janコード'],
  name: ['name', '商品名'],
  quantity: ['quantity', '在庫数', '在庫'],
  unitPrice: ['unit_price', 'unitprice', '単価', '価格'],
  operation: ['operation', '操作'],
  brand: ['brand', 'ブランド'],
  storeName: ['store_name', 'storename', 'ストア名'],
  productUrl: ['product_url', 'producturl', '商品url'],
};

@Injectable({ providedIn: 'root' })
export class CsvInventoryService {
  async read(file: File): Promise<CsvInventoryRow[]> {
    const text = await file.text();
    const rows = this.parse(text.replace(/^\uFEFF/, ''));
    if (rows.length < 2) {
      throw new Error('CSV には見出しと少なくとも 1 行の商品データが必要です。');
    }

    const headers = rows[0].map((header) => header.trim().toLowerCase());
    const data = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));

    return data.map((row, index) => {
      const barcode = this.value(row, headers, 'barcode').replace(/\s/g, '');
      if (!barcode) {
        throw new Error(`${index + 2} 行目: barcode（バーコード）がありません。`);
      }

      const quantityText = this.value(row, headers, 'quantity');
      const quantity = Number(quantityText || '0');
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error(`${index + 2} 行目: quantity は 0 以上の整数にしてください。`);
      }

      const priceText = this.value(row, headers, 'unitPrice');
      const unitPrice = priceText === '' ? null : Number(priceText);
      if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
        throw new Error(`${index + 2} 行目: unit_price が正しくありません。`);
      }

      return {
        barcode,
        name: this.value(row, headers, 'name'),
        quantity,
        unitPrice,
        operation: this.toOperation(this.value(row, headers, 'operation')),
        brand: this.value(row, headers, 'brand'),
        storeName: this.value(row, headers, 'storeName'),
        productUrl: this.value(row, headers, 'productUrl'),
      };
    });
  }

  download(items: InventoryItem[]): void {
    const lines = [
      [
        'barcode',
        'name',
        'quantity',
        'unit_price',
        'operation',
        'brand',
        'store_name',
        'product_url',
      ],
      ...items.map((item) => [
        item.barcode,
        item.name,
        String(item.quantity),
        item.unitPrice === null ? '' : String(item.unitPrice),
        'set',
        item.brand,
        item.storeName,
        item.productUrl,
      ]),
    ].map((row) => row.map((value) => this.escape(value)).join(','));

    const blob = new Blob(['\uFEFF', lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private value(row: string[], headers: string[], key: string): string {
    const position = headers.findIndex((header) => HEADER_ALIASES[key].includes(header));
    return position >= 0 ? (row[position] ?? '').trim() : '';
  }

  private toOperation(value: string): CsvOperation {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'set' || normalized === '上書き') return 'set';
    if (normalized === 'add' || normalized === '追加') return 'add';
    if (normalized === 'subtract' || normalized === '減算') return 'subtract';
    throw new Error(`operation は set、add、subtract のいずれかにしてください（${value}）。`);
  }

  private escape(value: string): string {
    return `"${String(value).replaceAll('"', '""')}"`;
  }

  private parse(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (character === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && next === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += character;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
}
