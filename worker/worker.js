const ALLOWED_ORIGINS = ['https://yokko405.github.io'];
const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 4000;
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 写真数枚分のbase64を許容しつつ暴走を防ぐ上限

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60000;

// IPごとに1インスタンスへ決定的にルーティングされ、同一インスタンスへの
// リクエストは直列実行されるため、Workers Rate Limiting binding(local
// cache方式でisolateをまたぐと合算されない)と違い、カウントの取りこぼしがない。
export class RateLimiterDO {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch() {
    const now = Date.now();
    let state = (await this.ctx.storage.get('state')) || { windowStart: now, count: 0 };
    if (now - state.windowStart >= RATE_WINDOW_MS) {
      state = { windowStart: now, count: 0 };
    }

    if (state.count >= RATE_LIMIT) {
      return Response.json({ success: false });
    }

    state.count += 1;
    await this.ctx.storage.put('state', state);
    return Response.json({ success: true });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    try {
      return await handleRequest(request, env, origin, headers);
    } catch {
      // 想定外の例外。原因の詳細(スタックトレース等)は
      // レスポンスにもログにも出さない。
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  }
};

async function handleRequest(request, env, origin, headers) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 2026-09-15: 認証なしで生APIキーを返していたため無効化。
  // 生キーを返す経路はこのWorkerのどこにも存在しない(yoko-task-hub Issue #2)。
  if (request.method === 'GET' && path === '/api/key') {
    return new Response(JSON.stringify({ error: 'This endpoint has been disabled for security reasons.' }), {
      status: 410,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  // Gemini呼び出しをサーバー側で完結させるプロキシ。
  // フロントエンドはAPIキーを一切持たない。Geminiを呼び出すのはこのハンドラのみ。
  if (request.method === 'POST' && path === '/api/generate') {
    const provider = url.searchParams.get('provider') || 'google';
    if (provider !== 'google') {
      return new Response(JSON.stringify({ error: 'Unsupported provider' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
        status: 403,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // KVのget->putは同時アクセスでeventual consistencyにより上限を超え得る。
    // また、Workers Rate Limiting bindingも"permissive, eventually consistent"で
    // isolateごとにローカルキャッシュされるため実測で上限を大きく超えて通過した。
    // Durable Objectは同一キーのリクエストを直列処理するため厳密にカウントできる。
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const doId = env.RATE_LIMITER_DO.idFromName(ip);
    const doStub = env.RATE_LIMITER_DO.get(doId);
    const doResponse = await doStub.fetch('https://rate-limiter/check');
    const { success: withinLimit } = await doResponse.json();
    if (!withinLimit) {
      return new Response(JSON.stringify({ error: 'Too many requests, please try again later' }), {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // Content-Lengthはクライアント申告値で信頼できない(chunked等で回避され得る)ため、
    // 実際に読み込んだバイト数で上限を判定する。
    const bodyBuffer = await request.arrayBuffer();
    if (bodyBuffer.byteLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: 'Request too large' }), {
        status: 413,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBuffer));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    if (!body || !Array.isArray(body.contents)) {
      return new Response(JSON.stringify({ error: '"contents" is required' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    const key = env.GEMINI_API_KEY;
    if (!key) {
      // シークレット未設定。内部事情のため詳細は返さずログにも残さない。
      return new Response(JSON.stringify({ error: 'Server is not configured' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // Gemini呼び出しは専用のtry/catchで囲み、失敗時も例外の生テキストを
    // レスポンス・ログのどちらにも出さない。キーはURLクエリではなく
    // x-goog-api-keyヘッダーで渡す(URL由来の漏えい面を減らすため)。
    let geminiResponse;
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify({
            contents: body.contents,
            generationConfig: {
              maxOutputTokens: MAX_OUTPUT_TOKENS
            }
          })
        }
      );
    } catch {
      return new Response(JSON.stringify({ error: 'Upstream request to Gemini failed' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // 成功時のみGeminiの応答をそのまま返す。非2xxは上流の詳細(エラーメッセージ、
    // リクエスト内容の反映など)を外へ出さないよう汎用エラーに差し替える。
    if (!geminiResponse.ok) {
      return new Response(JSON.stringify({ error: 'Gemini request failed' }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    const resultText = await geminiResponse.text();
    return new Response(resultText, {
      status: geminiResponse.status,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  if (path === '/') {
    return new Response('TaviLog API is running!', { headers });
  }

  return new Response('Not Found', { status: 404, headers });
}
