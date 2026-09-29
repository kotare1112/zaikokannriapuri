/**
 * Firebase コンソールで取得した Web アプリの設定値と、Yahoo! JAPAN の Client ID を設定します。
 * Firebase の Web 設定値は公開される前提の値です。Firestore のアクセス制御は必ず
 * Firebase Security Rules で行ってください。
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyBkEUf8egWytmGIF70KBBIyIbY-2KgHDnE',
    // Vercel の同一ドメインで Firebase Auth ヘルパーをプロキシし、
    // iPhone / iPad のストレージ分離によるリダイレクト認証の失敗を防ぎます。
    authDomain: 'zaikokannriapuri.vercel.app',
    projectId: 'zaikokannriapuri-d3a2a',
    storageBucket: 'zaikokannriapuri-d3a2a.firebasestorage.app',
    messagingSenderId: '86867562188',
    appId: '1:86867562188:web:f61b0a180ea3e506873c69',
    measurementId: 'G-4W7BLV5CM6',
  },
  yahooShopping: {
    // Vercel 構成では使用しません。Client ID は Vercel の環境変数に移してください。
    appId: 'dmVyPTIwMjUwNyZpZD1JYkNlUThmSERLJmhhc2g9TTJObU4yUXdZV00wWkRKbFpUbGhaZw',
    // Vercel 上では同じデプロイメントのサーバーレス関数を呼び出します。
    proxyUrl: '/api/yahoo-item-search',
  },
  access: {
    developerEmail: 'kotare1112@gmail.com',
  },
};
