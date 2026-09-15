# tavilog-api2 Worker

tavilog(`https://yokko405.github.io/tavilog/`)から呼び出される、Gemini API呼び出し専用のCloudflare Worker。

## 経緯

以前は `GET /api/key` が認証なしで生のGemini APIキーを返しており、誰でも取得・悪用できる状態だった([yoko-task-hub Issue #2](https://github.com/Yokko405/yoko-task-hub/issues/2))。現在は:

- `/api/key` は常に `410 Gone` を返すのみで、生キーを返す経路はコード上どこにも存在しない
- Gemini APIキーはWorkerのシークレット(`env.GEMINI_API_KEY`)としてのみ保持し、フロントエンドには一切渡さない
- Gemini呼び出しは `POST /api/generate` がサーバー側で行い、結果のみをフロントへ返す

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/` | ヘルスチェック |
| GET | `/api/key` | 無効化済み。常に410を返す |
| POST | `/api/generate?provider=google` | フロントから `{ contents: [...] }` を受け取り、Gemini(`gemini-2.5-flash`)を呼び出して結果を返す |

## セキュリティ上の制約(`/api/generate`)

- CORSは `https://yokko405.github.io` のみ許可(それ以外は403)
- レート制限: 15 req/60秒/IP。`RateLimiterDO`(Durable Object)を使用。IPごとに1インスタンスへ
  決定的にルーティングされ、同一インスタンスへのリクエストは直列処理されるため厳密にカウントできる。
  KVのget->put方式(同一キー書込1回/秒、eventual consistency)や、Cloudflare Workers Rate Limiting
  binding(isolateごとにローカルキャッシュされ"permissive, eventually consistent")は実測で
  上限を大きく超えて通過することを確認済みのため不採用
- Gemini APIキーは `x-goog-api-key` ヘッダーで渡す(URLクエリに入れない。Observabilityのトレースに
  URLが残る経路を避けるため)
- `generationConfig.maxOutputTokens` はクライアントの指定を無視し、サーバー側で常に4000に固定
- リクエストボディは15MB上限。`Content-Length`ヘッダーは信頼せず、実際に読み込んだバイト数で判定
  (`Content-Length`なし/chunkedでの回避を防ぐ)
- Gemini呼び出しの失敗時、URL(APIキーを含む)や例外の生テキスト、Geminiからの非2xx応答本文は
  レスポンス・ログのどちらにも出力しない(汎用エラーメッセージのみ返す)

## デプロイ

```bash
cd worker
npx wrangler deploy
```

`wrangler.toml` の `account_id` ・Worker名(`tavilog-api2`)・Durable Objectバインディング(`RATE_LIMITER_DO`)は本番と一致させてあるため、認証済みの `wrangler` があればそのままデプロイできる。

**デプロイ前に必ず `--dry-run` で差分を確認すること**(意図しない設定変更が本番に混ざるのを防ぐため):

```bash
npx wrangler deploy --dry-run
```

## シークレットの設定(`GEMINI_API_KEY`)

このリポジトリには**絶対にAPIキーそのものをコミットしない**。Cloudflareのシークレットとしてのみ保持する。

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
# プロンプトでキーの値を入力(ターミナル履歴やコミットに残らない)
```

キーをローテーションする場合も同じコマンドで上書きできる。

### ローカル開発時

`.dev.vars.example` を `.dev.vars` にコピーして値を入れる(`.dev.vars` は `.gitignore` 済み):

```bash
cp .dev.vars.example .dev.vars
# .dev.vars の GEMINI_API_KEY= に実際の値を設定してから
npx wrangler dev
```

## 動作確認

```bash
# /api/key は常に410
curl -i "https://tavilog-api2.hiyume-2.workers.dev/api/key?provider=google"

# 許可外オリジンからの /api/generate は403
curl -s -X POST "https://tavilog-api2.hiyume-2.workers.dev/api/generate?provider=google" \
  -H "Origin: https://evil.example.com" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"hi"}]}]}'

# 許可オリジンからは200でGeminiの応答が返る
curl -s -X POST "https://tavilog-api2.hiyume-2.workers.dev/api/generate?provider=google" \
  -H "Origin: https://yokko405.github.io" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"ping"}]}]}'
```
