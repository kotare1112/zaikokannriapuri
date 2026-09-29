/**
 * Firebase コンソールで取得した Web アプリの設定値と、Yahoo! JAPAN の Client ID を設定します。
 * Firebase の Web 設定値は公開される前提の値です。Firestore のアクセス制御は必ず
 * Firebase Security Rules で行ってください。
 */
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyBkEUf8egWytmGIF70KBBIyIbY-2KgHDnE',
    authDomain: 'zaikokannriapuri.firebaseapp.com',
    projectId: 'zaikokannriapuri',
    storageBucket: 'zaikokannriapuri.appspot.com',
    messagingSenderId: '1084468484848',
    appId: '1:1084468484848:web:1234567890abcdef',
  },
  yahooShopping: {
    // Vercel 構成では使用しません。Client ID は Vercel の環境変数に移してください。
    appId: 'dmVyPTIwMjUwNyZpZD1JYkNlUThmSERLJmhhc2g9TTJObU4yUXdZV00wWkRKbFpUbGhaZw',
    // Vercel 上では同じデプロイメントのサーバーレス関数を呼び出します。
    proxyUrl: '/api/yahoo-item-search',
  },
};
