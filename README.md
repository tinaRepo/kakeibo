# 家計簿 Web アプリ

支出・収入・サブスクを記録して、年間・月別に集計し、円グラフと予算の進捗で確認できる家計簿アプリです。家族などと共有でき、レシート画像の添付や、電波がない場所での入力にも対応しています。スマホのホーム画面に追加して、アプリのように使えます(PWA)。

## 主な機能

- **記録と集計**: 支出・収入・サブスクの登録、年間 / 月別の集計、カテゴリ × 月の表、円グラフ(タップで内訳と明細)
- **予算**: カテゴリ別と全体の月額予算、月ごとの上書き、進捗バー(80%・100%で色が変わる)、超過の通知
- **共有**: 家計簿のオーナーが、メンバーごとに権限(明細・カテゴリ・サブスク・予算の編集)を決めて招待
- **レシート画像**: 1明細5枚まで。端末側で圧縮し、位置情報を削除して保存
- **オフライン入力**: 電波がなくても入力でき、つながると自動で同期
- **ログイン**: ログインIDとパスワード、またはコード / QR(別の端末への引き継ぎ)
- **CSV**: 書き出しと取り込み
- **通知**: 問い合わせへの返信・お知らせ・予算超過をプッシュ通知(内容は含めない)
- **管理者機能**: 問い合わせ対応、お知らせ配信、利用状況の確認、コード紛失時の引き継ぎ支援

## 技術構成

| 領域 | 採用 |
|---|---|
| フロントエンド | Vite + React + TypeScript、React Router、TanStack Query、Chart.js |
| PWA / オフライン | Service Worker(Workbox)、IndexedDB(Dexie) |
| API | Cloudflare Workers + Hono |
| データベース / 画像 | Cloudflare D1(SQLite)/ R2(非公開バケット) |
| 通知 / 定期処理 | Web Push(VAPID)/ Cron Triggers |
| 認証・防御 | セッション Cookie、PBKDF2 によるパスワード保存、管理者ログイン(パスワード + 確認コード)、Turnstile、レート制限 |

```
ブラウザ(PWA) ──▶ Cloudflare Workers(Hono)──▶ D1(データ)/ R2(画像)
   │  └ IndexedDB(オフライン入力・同期)        └ Cron(通知・掃除) / Web Push
   └ 管理者画面 /admin ──▶ (パスワード + 確認コード)──▶ Workers
```

## プライバシーとセキュリティ

- 保存するのは、表示名・家計簿の内容・画像・端末情報、設定した場合のログインIDとパスワードのハッシュです。メールアドレスと電話番号は取得しません。
- コードやパスワードは、元に戻せない形(ハッシュ)でのみ保存します。
- 管理者が家計簿の内容を見られるのは、コード紛失時の引き継ぎ確認(候補の直近100件)に限り、閲覧は記録に残ります。
- 管理者画面は、パスワードと確認コード(2段階認証)で保護します。独自ドメインがあれば、Cloudflare Access も併用できます。

## はじめかた

```bash
npm install
npm run db:migrate                 # ローカルDBを作成
cp .dev.vars.example .dev.vars     # 管理者画面のローカル用の設定など
npm run dev:api                    # ターミナル1: API
npm run dev                        # ターミナル2: 画面 → http://localhost:5173
```

テストは `npm test` で実行できます。Cloudflare への公開(検証環境・本番環境)や、自動デプロイの設定は、**[docs/](docs/README.md)** にまとめています(独自ドメインは不要です)。

## ドキュメント

- [環境構築ガイド(dev / production / ローカル)](docs/cloudflare-setup.md)
- [管理者ログインの設定](docs/admin-auth.md)
- [Cloudflare Access の設定(独自ドメインを取得したら)](docs/cloudflare-access.md)
- [自動デプロイ(GitHub Actions)](docs/deploy-cicd.md)
- [コマンド一覧](docs/commands.md)
- [Git の運用ルール(コミットメッセージなど)](docs/git-conventions.md)
- [実機の動作確認チェックリスト](docs/device-checklist.md)
- [仕様書 v5 からの変更点](docs/spec-changes.md)

## ディレクトリ構成

```
src/worker/    API(認証・明細・集計・メンバー・通知・引き継ぎ・Cron)
src/web/       画面(利用者 / 管理者 /admin / オフライン同期 / Service Worker)
migrations/    D1のマイグレーションSQL
tests/         自動テスト(npm test)
docs/          環境構築・運用の資料
.github/       CIとデプロイのワークフロー
wrangler.toml  Cloudflareの設定(ローカル / dev / production)
```
