// Cloudflare Pages Functions用のミドルウェア
// 環境変数からGoogle API Keyを読み取ってHTMLに注入

export async function onRequest(context) {
  const { request, env, next } = context;

  // 次のハンドラーを実行してレスポンスを取得
  const response = await next();

  // HTMLの場合のみ処理
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('text/html')) {
    let html = await response.text();

    // 環境変数からAPIキーを取得して置換
    if (env.GOOGLE_API_KEY) {
      html = html.replace(/YOUR_GOOGLE_API_KEY_HERE/g, env.GOOGLE_API_KEY);
    }

    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  return response;
}
