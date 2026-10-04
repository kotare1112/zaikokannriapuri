# ZAIKO FLOW

Angular と Firebase（Cloud Firestore）で作る、バーコード起点の在庫管理アプリです。カメラで JAN コードを読むかコードを入力すると、保存済みの商品マスターを確認し、未登録なら Yahoo!ショッピング商品検索 API v3 から商品情報を取得します。商品名と在庫数を確認してから、Firestore の `inventoryItems` コレクションに登録します。

## 実装済みの機能

- カメラによる JAN / EAN / UPC などのバーコード読取り（カメラを使えない端末では番号入力）
- Yahoo!ショッピング商品検索 API v3 の `jan_code` による商品情報の取得と重複防止
- バーコード読取りによる登録・削除、Firestore とのリアルタイム同期、在庫数の増減、在庫僅少の表示
- Google ログイン、家族の利用申請、開発者による承認フロー
- 登録前の在庫数確認、API に商品がない場合の商品名入力
- `productMasters` に商品情報を保存し、在庫から削除した後も再登録時に再利用
- 商品名・JAN・ジャンル検索に加え、登録済み在庫に対する無料のローカル AI 関連検索

## AI 関連検索

検索を送信すると、文字・ジャンル・別名検索の結果をすぐ表示します。確実な一致が見つからないときだけ、多言語 E5 small で関連候補を探します。AI は端末内の Web Worker で実行し、商品名を推論 API へ送信しません。モデルは AI 検索が必要になったとき Hugging Face から初めて取得されるため、初回のみ約 135 MB の通信と端末側の計算時間が必要です。通信できない場合や端末が対応しない場合も、従来の文字・ジャンル・JAN 検索はそのまま使えます。モデルの関連判定は推測であり、すべての商品や抽象表現で正しい結果を保証するものではありません。

## 初期設定

1. Firebase コンソールで Web アプリと Cloud Firestore を作成します。
2. `src/environments/environment.ts` に Firebase の Web 設定を入力します。
3. [Yahoo!デベロッパーネットワーク](https://developer.yahoo.co.jp/) でアプリケーションを作成し、Client ID を取得します。
4. 下記「Vercel の設定」を完了してから、依存関係を入れて起動します。

```bash
npm install
npm start
```

ブラウザで `http://localhost:4200` を開きます。カメラ読取りには HTTPS または localhost とブラウザのカメラ許可が必要です。

## Vercel の設定（Yahoo API プロキシ）

Yahoo!商品検索 API はブラウザから直接呼び出すと CORS により遮断されるため、このリポジトリには Vercel Function の `api/yahoo-item-search.ts` が含まれています。Yahoo! の Client ID はフロントエンドには置かず、Vercel の環境変数へ設定してください。

1. この Git リポジトリを Vercel に Import します。Framework Preset は `Angular`、Build Command は `npm run build`、Output Directory は `dist/zaiko-inventory/browser` です。
2. Vercel の対象プロジェクトで **Settings → Environment Variables** を開きます。
3. 以下の環境変数を Production / Preview / Development に追加します。

   ```text
   YAHOO_SHOPPING_APP_ID=Yahoo!デベロッパーネットワークで発行したClient ID
   ```

4. Deploy します。フロントエンドは同じ Vercel デプロイメントの `/api/yahoo-item-search` を自動的に利用します。

`src/environments/environment.ts` の `yahooShopping.proxyUrl` は `/api/yahoo-item-search` のままにしてください。`yahooShopping.appId` は Vercel 構成では不要なので、環境変数の設定後は空欄にして構いません。

### Firestore Security Rules

このリポジトリの `firestore.rules` は、開発者のGoogleアカウントと、開発者が承認した利用者だけに `inventoryItems` と `productMasters` の参照を許可します。`productMasters` は新規作成のみ許可し、在庫から商品を削除しても残ります。ルール変更時は次で反映します。

```bash
firebase deploy --only firestore
```

## 本番運用メモ

- Firebase の Web 設定値はクライアントに含まれる前提です。データの保護は Security Rules と Authentication で行ってください。
- 開発者アカウントは `src/environments/environment.ts` の `access.developerEmail` と `firestore.rules` の両方で指定します。変更する場合は両方を同じメールアドレスへ更新してください。
- Yahoo! の Client ID は Vercel の `YAHOO_SHOPPING_APP_ID` として管理します。`.env.local` などの実値ファイルは Git に追加しないでください。
- `npm run build` で本番ビルドを検証できます。
