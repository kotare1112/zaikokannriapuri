const YAHOO_FURIGANA_URL = 'https://jlp.yahooapis.jp/jsonrpc';

declare const process: { env: Record<string, string | undefined> };

type FuriganaResponse = {
  result?: { word?: { surface?: string; furigana?: string }[] };
  error?: { message?: string };
};

export async function GET(request: Request): Promise<Response> {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (!query || [...query].length > 80) {
    return jsonResponse({ error: '検索語は1〜80文字で指定してください。' }, 400);
  }

  const appId = process.env['YAHOO_SHOPPING_APP_ID'];
  if (!appId) {
    return jsonResponse({ error: 'Yahoo! JAPAN の Client ID が設定されていません。' }, 500);
  }

  try {
    const upstream = await fetch(YAHOO_FURIGANA_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `Yahoo AppID: ${appId}`,
      },
      body: JSON.stringify({
        id: 'inventory-search',
        jsonrpc: '2.0',
        method: 'jlp.furiganaservice.furigana',
        params: { q: query, grade: 1 },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!upstream.ok) {
      return jsonResponse({ error: '漢字の読みを取得できませんでした。' }, upstream.status === 429 ? 429 : 502);
    }
    const response = await upstream.json() as FuriganaResponse;
    if (response.error || !Array.isArray(response.result?.word)) {
      return jsonResponse({ error: '漢字の読みを取得できませんでした。' }, 502);
    }
    const reading = response.result.word.map((word) => word.furigana || word.surface || '').join('');
    return jsonResponse({ reading }, 200);
  } catch {
    return jsonResponse({ error: '漢字の読みを取得できませんでした。' }, 502);
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
