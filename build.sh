#!/bin/bash

# Cloudflare Pagesのビルド時に環境変数からAPIキーを注入するスクリプト

if [ -z "$GOOGLE_API_KEY" ]; then
  echo "Warning: GOOGLE_API_KEY environment variable is not set"
  echo "The app will work with user-provided API keys only"
else
  echo "Injecting GOOGLE_API_KEY into index.html"
  # Linux (Cloudflare Pages) では sed -i の後に空文字列が必要
  sed -i.bak "s|YOUR_GOOGLE_API_KEY_HERE|$GOOGLE_API_KEY|g" index.html && rm -f index.html.bak
  echo "API key injection completed"
fi

# ビルド出力は同じディレクトリ
echo "Build completed successfully"
