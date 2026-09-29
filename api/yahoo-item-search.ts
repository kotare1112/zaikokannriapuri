const YAHOO_ITEM_SEARCH_URL = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

declare const process: { env: Record<string, string | undefined> };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  Vary: 'Origin',
};

/**
 * Yahoo!ショッピング商品検索 API の Vercel プロキシ。
 * Client ID は Vercel の環境変数 YAHOO_SHOPPING_APP_ID にだけ保存します。
 */
export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const janCode = (requestUrl.searchParams.get('jan_code') ?? '').replace(/[\s-]/g, '');

  if (!/^\d{8,14}$/.test(janCode)) {
    return jsonResponse({ error: '8〜14桁の JAN コードを指定してください。' }, 400);
  }

  const appId = process.env['YAHOO_SHOPPING_APP_ID'];
  if (!appId) {
    return jsonResponse(
      {
        error: 'Vercel の環境変数 YAHOO_SHOPPING_APP_ID が設定されていません。',
      },
      500,
    );
  }

  const hits = Math.min(
    10,
    Math.max(1, Number.parseInt(requestUrl.searchParams.get('hits') ?? '', 10) || 1),
  );
  const upstreamUrl = new URL(YAHOO_ITEM_SEARCH_URL);
  upstreamUrl.searchParams.set('appid', appId);
  upstreamUrl.searchParams.set('jan_code', janCode);
  upstreamUrl.searchParams.set('hits', String(hits));

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
    });
    const body = await upstreamResponse.text();

    return new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return jsonResponse({ error: 'Yahoo!ショッピング API への接続に失敗しました。' }, 502);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
