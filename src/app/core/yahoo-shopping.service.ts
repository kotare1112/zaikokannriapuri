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
  price?: number;
  url?: string;
  image?: { medium?: string; small?: string };
  brand?: { name?: string };
  seller?: { name?: string };
}

const ITEM_SEARCH_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

@Injectable({ providedIn: 'root' })
export class YahooShoppingService {
  private readonly http = inject(HttpClient);

  searchByBarcode(barcode: string): Observable<CatalogProduct[]> {
    const usingProxy = Boolean(environment.yahooShopping.proxyUrl);
    if (!usingProxy && !environment.yahooShopping.appId) {
      return throwError(
        () =>
          new Error(
            'src/environments/environment.ts に Yahoo!ショッピングの Client ID を設定してください。',
          ),
      );
    }

    const endpoint = environment.yahooShopping.proxyUrl || ITEM_SEARCH_URL;
    let params = new HttpParams().set('jan_code', barcode).set('hits', '10');
    if (!usingProxy) {
      params = params.set('appid', environment.yahooShopping.appId);
    }

    return this.http.get<YahooSearchResponse>(endpoint, { params }).pipe(
      map((response) =>
        (response.hits ?? []).map((hit) => ({
          barcode,
          name: hit.name?.trim() || `JAN ${barcode}`,
          unitPrice: Number.isFinite(hit.price) ? hit.price! : null,
          imageUrl: hit.image?.medium ?? hit.image?.small ?? '',
          productUrl: hit.url ?? '',
          brand: hit.brand?.name ?? '',
          storeName: hit.seller?.name ?? '',
        })),
      ),
    );
  }
}
