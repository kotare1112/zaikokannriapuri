import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { CatalogProduct } from '../models/inventory-item';

interface YahooSearchResponse {
  hits?: YahooHit[];
}

interface YahooHit {
  name?: string;
  url?: string;
  image?: { medium?: string; small?: string };
  brand?: { name?: string };
  seller?: { name?: string };
}

@Injectable({ providedIn: 'root' })
export class YahooShoppingService {
  private readonly http = inject(HttpClient);

  searchByBarcode(barcode: string): Observable<CatalogProduct[]> {
    const endpoint = environment.yahooShopping.proxyUrl.trim();
    if (!endpoint) {
      return throwError(
        () =>
          new Error(
            'Vercel のデプロイ後、src/environments/environment.ts の yahooShopping.proxyUrl に /api/yahoo-item-search の URL を設定してください。',
          ),
      );
    }

    const params = new HttpParams().set('jan_code', barcode).set('hits', '10');

    return this.http.get<YahooSearchResponse>(endpoint, { params }).pipe(
      map((response) =>
        (response.hits ?? []).map((hit) => ({
          barcode,
          name: this.productNameWithoutPackCount(hit.name, barcode),
          imageUrl: hit.image?.medium ?? hit.image?.small ?? '',
          productUrl: hit.url ?? '',
          brand: hit.brand?.name ?? '',
          storeName: hit.seller?.name ?? '',
        })),
      ),
    );
  }

  private productNameWithoutPackCount(name: string | undefined, barcode: string): string {
    if (!name?.trim()) return `JAN ${barcode}`;

    // 商品名の末尾に付く「6本」「24缶入り」「3個セット」などは、
    // 在庫として数える商品名には含めない。500ml などの容量表記は残す。
    const packCount = String.raw`(?:約\s*)?\d+\s*(?:本|個|缶|袋|枚|食|箱|パック|セット|ケース)(?:\s*(?:入り?|入|セット|パック|ケース))?`;
    const trailingPackCount = new RegExp(
      String.raw`(?:\s|　|[・/／|、,，\-×xX*＊])*[\[\(（【]?\s*${packCount}\s*[\]\)）】]?(?:\s*(?:セット|パック|ケース))?\s*$`,
      'u',
    );

    let normalized = name.trim();
    let beforeRemoval = '';
    while (normalized !== beforeRemoval) {
      beforeRemoval = normalized;
      normalized = normalized.replace(trailingPackCount, '').trim();
    }

    normalized = normalized
      .replace(/[\s　]+/gu, ' ')
      .replace(/[・/／|、,，-]+\s*$/u, '')
      .trim();

    return normalized || name.trim();
  }
}
