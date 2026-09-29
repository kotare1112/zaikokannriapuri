# ZAiKO FLOW

Angular と Firebase（Cloud Firestore）で作る、バーコード起点の在庫管理アプリです。カメラで JAN コードを読むかコードを入力すると、Yahoo!ショッピング商品検索 API v3 から先頭の商品情報を取得し、Firestore の `inventoryItems` コレクションに登録します。

## 実装済みの機能

- カメラによる JAN / EAN / UPC などのバーコード読取り（カメラを使えない端末では番号入力）
- Yahoo!ショッピング商品検索 API v3 の `jan_code` による商品情報の自動登録
- Firestore とのリアルタイム同期、在庫数の増減、在庫僅少の表示
- CSV の UTF-8（BOM 付き）出力と読み込み
- API に商品がない場合の手入力登録

## 初期設定

1. Firebase コンソールで Web アプリと Cloud Firestore を作成します。
2. `src/environments/environment.ts` に Firebase の Web 設定を入力します。
3. [Yahoo!デベロッパーネットワーク](https://developer.yahoo.co.jp/) でアプリケーションを作成し、Client ID を `yahooShopping.appId` に入力します。
4. 依存関係を入れて起動します。

```bash
npm install
npm start
```

ブラウザで `http://localhost:4200` を開きます。カメラ読取りには HTTPS または localhost とブラウザのカメラ許可が必要です。

### Firestore Security Rules（開発用の最小例）

次のルールは**認証をまだ実装していない開発中だけ**に使用してください。本番運用では Firebase Authentication を追加し、組織の利用者だけに絞り込んでください。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /inventoryItems/{barcode} {
      allow read, write: if true;
    }
  }
}
```

## CSV 形式

エクスポートした CSV はそのままインポートできます。利用できる列は以下です。`barcode` と `quantity` を必須とし、`operation` は `set`（在庫数を上書き、既定）、`add`（加算）、`subtract`（減算）です。日本語見出しの `バーコード`、`商品名`、`在庫数`、`単価`、`操作` も受け付けます。

```csv
barcode,name,quantity,unit_price,operation,brand,store_name,product_url
4900000000000,サンプル商品,12,980,set,サンプルブランド,サンプルストア,https://example.com/item
```

## 本番運用メモ

- Firebase の Web 設定値はクライアントに含まれる前提です。データの保護は Security Rules と Authentication で行ってください。
- Yahoo! の Client ID をフロントエンドに置きたくない、または API の利用制御をしたい場合は、Cloud Functions 等で `proxyUrl` を実装して `environment.ts` の `yahooShopping.proxyUrl` に設定してください。
- `npm run build` で本番ビルドを検証できます。
