// Cloudflare Pages用のWorker
// 環境変数からGoogle API Keyを読み取ってHTMLに注入

export async function onRequest(context) {
  const { request, env } = context;

  // index.htmlを取得
  const response = await context.next();

  // HTMLの場合のみ処理
  if (response.headers.get('content-type')?.includes('text/html')) {
    let html = await response.text();

    // 環境変数からAPIキーを取得して置換
    if (env.GOOGLE_API_KEY) {
      html = html.replace('YOUR_GOOGLE_API_KEY_HERE', env.GOOGLE_API_KEY);
    }

    return new Response(html, {
      headers: response.headers
    });
  }

  return response;
}
