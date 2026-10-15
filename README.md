# 📝 PDF Note - PDFに書き込み・共有・印刷

PDFファイルに自由に書き込みができて、リンクで共有・印刷もできるWebアプリです。

## 機能

- ✏️ **ペン・マーカー・テキスト・消しゴム**ツールで書き込み
- 💾 **自動保存** (書き込み後1.5秒で自動保存)
- 🔗 **共有リンク生成** (読み取り専用リンクを作成)
- 🖨️ **印刷** (書き込みを含めてそのまま印刷)
- ↩️ **元に戻す** (Ctrl+Z または ボタン)
- 📱 **マルチページ対応**

## セットアップ手順

### 1. Supabase プロジェクトを作成

1. [https://supabase.com](https://supabase.com) にアクセスしてアカウント作成
2. 「New project」をクリックして新しいプロジェクトを作成
3. プロジェクト名と強力なパスワードを設定

### 2. データベースを設定

1. Supabase ダッシュボード → **SQL Editor** を開く
2. このリポジトリの `supabase-schema.sql` の内容をすべてコピーして実行

### 3. Anonymous Auth を有効化

1. Supabase ダッシュボード → **Authentication** → **Providers**
2. **Anonymous Sign-Ins** を「Enabled」に切り替え

### 4. 環境変数を設定

1. Supabase ダッシュボード → **Settings** → **API** を開く
2. 以下の2つの値をコピー:
   - **Project URL**
   - **anon public** キー

3. `.env.local.example` を `.env.local` にコピーして値を設定:
```
NEXT_PUBLIC_SUPABASE_URL=あなたのProject URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=あなたのanon publicキー
```

### 5. ローカルで動かす

```bash
npm install
npm run dev
```

→ http://localhost:3000 で開く

## Vercel へのデプロイ

### 1. GitHub にプッシュ

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/あなたのユーザー名/pdf-annotator.git
git push -u origin main
```

### 2. Vercel でデプロイ

1. [https://vercel.com](https://vercel.com) にアクセス（GitHubアカウントでログイン）
2. 「Add New Project」→ GitHubリポジトリを選択
3. **Environment Variables** に以下を追加:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. 「Deploy」ボタンをクリック

## 無料枠について

| サービス | 無料枠 |
|---------|--------|
| Vercel | 無制限の個人プロジェクト |
| Supabase | 500MB ストレージ、1GB DB、50MBファイル上限/個 |
| GitHub | 無制限のパブリック/プライベートリポジトリ |

大学の授業資料程度なら無料枠で十分使えます。

## 技術スタック

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **PDF.js** (PDFレンダリング)
- **Supabase** (認証・DB・ファイルストレージ)
