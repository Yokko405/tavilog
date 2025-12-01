# ✈️ TaviLog - 旅の記録をブログに

<p align="center">
  <img src="images/apple-touch-icon.png" alt="TaviLog" width="120">
</p>

<p align="center">
  <strong>写真とメモからAIが素敵な旅行ブログを自動生成！</strong>
</p>

<p align="center">
  <a href="https://yokko405.github.io/tavilog/">🌐 アプリを使う</a>
</p>

---

## 🎯 特徴

- 📸 **写真アップロード** - 旅行中に撮った写真を追加
- 📝 **メモ追加** - 感想や思い出をメモ
- 🤖 **AI生成** - GPT-4o / Claude が魅力的なブログ記事を自動作成
- 🖼️ **Vision対応** - AIが写真の内容を認識して適切な場所に配置
- ✏️ **編集機能** - 生成後にテキストや写真の位置を自由に調整
- 💖 **お気に入り保存** - 気に入ったブログをローカルに保存
- 📱 **スマホ対応** - iPhoneでも快適に使える

## 🚀 使い方

1. **旅行を作成** - 旅行名と日付を入力
2. **素材を追加** - 写真やメモをアップロード
3. **ブログ生成** - AIがブログ記事を自動作成
4. **編集・保存** - お好みで調整して保存

## 🔑 APIキー

Google Gemini、OpenAI、または Anthropic のAPIキーが必要です。
アプリ上部の入力欄に設定してください。

### Cloudflare Pagesで環境変数を設定する場合

Cloudflare Pagesにデプロイする場合、Google APIキーを環境変数として安全に管理できます：

1. Cloudflareダッシュボードにログイン
2. Pages → あなたのプロジェクト → Settings → Environment variables
3. 以下の環境変数を追加：
   - **Variable name**: `GOOGLE_API_KEY`
   - **Value**: Google AI Studioで取得したAPIキー（[こちら](https://aistudio.google.com/apikey)で取得）
   - **Environment**: Production（本番環境）
4. Settings → Builds & deployments で以下を設定：
   - **Build command**: `./build.sh`
   - **Build output directory**: `/`（ルートディレクトリ）
5. 変更を保存してサイトを再デプロイ

`build.sh` スクリプトがビルド時に自動的にAPIキーをHTMLに注入します。

## 📱 iPhoneホーム画面に追加

Safariで開いて「ホーム画面に追加」すると、アプリのように使えます！

---

<p align="center">
  Made with 💖 by Yokko
</p>
