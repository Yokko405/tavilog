const ALLOWED_ORIGINS = ['https://yokko405.github.io'];
const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 4000;
const MAX_BODY_BYTES = 15 * 1024 * 1024; // 写真数枚分のbase64を許容しつつ暴走を防ぐ上限
const RATE_LIMIT_PER_MINUTE = 15;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function checkRateLimit(env, ip) {
  const bucket = Math.floor(Date.now() / 60000); // 1分単位
  const key = `ratelimit:${ip}:${bucket}`;
  const current = parseInt((await env.TAVILOG_KV.get(key)) || '0', 10);
  if (current >= RATE_LIMIT_PER_MINUTE) {
    return false;
  }
  await env.TAVILOG_KV.put(key, String(current + 1), { expirationTtl: 90 });
  return true;
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

      const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: 'Request too large' }), {
          status: 413,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const allowed = await checkRateLimit(env, ip);
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'Too many requests, please try again later' }), {
          status: 429,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      let body;
      try {
        body = await request.json();
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

      // Gemini呼び出しは専用のtry/catchで囲み、失敗時もURL(キーを含む)や
      // 例外の生テキストをレスポンス・ログのどちらにも出さない。
      let geminiResponse;
      try {
        geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
