# コマンド一覧

## 1. npm スクリプト(`package.json`)

| コマンド | 内容 |
|---|---|
| `npm install` | 依存パッケージのインストール(Node.js 20以上) |
| `npm run dev` | 画面の開発サーバー(http://localhost:5173)。`/api` は 8787 に中継 |
| `npm run dev:api` | API(Worker)のローカル起動(http://localhost:8787)。空の `dist` を自動作成 |
| `npm run build` | 本番用ビルド(`dist/`)。Service Worker も生成 |
| `npm run typecheck` | 型チェック(web / worker / Service Worker) |
| `npm run db:migrate` | ローカルDBにマイグレーションを適用(`.wrangler/` に作成) |
| `npm run db:migrate:dev` | 検証環境のDBにマイグレーションを適用 |
| `npm run db:migrate:prod` | 本番のDBにマイグレーションを適用 |
| `npm run deploy:dev` | ビルドして検証環境にデプロイ |
| `npm run deploy:prod` | ビルドして本番にデプロイ |
| `npm run logs:dev` / `logs:prod` | Worker のログをリアルタイム表示 |
| `npm test` | 自動テスト(API・管理者ログイン・同期・Access検証)。専用のDB・ポート8788で起動するので、開発中のDBには影響しない。特定のものだけなら `npm test -- 同期` |
| `npm run admin:setup` | 管理者ログインの秘密(パスワードのハッシュ・確認コードの種)を作る |
| `npm run vapid` | Web Push の鍵ペアを生成 |

## 2. wrangler(Cloudflare)

環境の指定: なし=ローカル設定 / `--env dev` / `--env production`

| やること | コマンド |
|---|---|
| ログイン / 確認 | `npx wrangler login` / `npx wrangler whoami` |
| D1 を作る | `npx wrangler d1 create kakeibo-dev` |
| D1 に SQL を実行 | `npx wrangler d1 execute DB --remote --env dev --command "SELECT COUNT(*) FROM members"` |
| D1 のマイグレーション状況 | `npx wrangler d1 migrations list DB --remote --env dev` |
| D1 のバックアップ | `npx wrangler d1 export DB --remote --env production --output backup.sql` |
| R2 を作る | `npx wrangler r2 bucket create kakeibo-receipts-dev` |
| 秘密を登録 / 一覧 | `npx wrangler secret put VAPID_PRIVATE_KEY --env dev` / `npx wrangler secret list --env dev`(登録する秘密: `VAPID_PRIVATE_KEY` `TURNSTILE_SECRET` `ADMIN_PASSWORD_HASH` `ADMIN_SESSION_SECRET` `ADMIN_TOTP_SECRET`) |
| デプロイ(設定の検証だけ) | `npx wrangler deploy --dry-run --env dev --outdir /tmp/out` |
| ログを見る | `npx wrangler tail --env production` |
| 前のバージョンに戻す | `npx wrangler rollback --env production` |
| ローカルで Cron を試す | `npx wrangler dev --test-scheduled` → http://localhost:8787/cdn-cgi/handler/scheduled |

ローカルのDBを作り直す: `.wrangler/` を削除 → `npm run db:migrate`(Windows PowerShell: `Remove-Item -Recurse -Force .wrangler`)

## 3. Git

| やること | コマンド |
|---|---|
| 状態の確認 | `git status` / `git diff` / `git log --oneline -10` |
| ブランチを作って移動 | `git checkout -b feature/xxx`(または `git switch -c feature/xxx`) |
| 最新を取り込む | `git pull` / `git fetch --all --prune` |
| 変更をステージ | `git add -p`(確認しながら) / `git add <ファイル>` |
| コミット | `git commit`(テンプレート使用時)/ `git commit -m "feat(web): ..."` |
| 直前のコミットを直す | `git commit --amend`(プッシュ前のみ) |
| プッシュ | `git push -u origin <ブランチ名>` |
| 一時退避 / 戻す | `git stash` / `git stash pop` |
| 特定のコミットだけ取り込む | `git cherry-pick <コミットID>` |
| ブランチの変更を取り込む | `git merge develop`(または `git rebase develop`) |
| コミットの取り消し(履歴を残す) | `git revert <コミットID>` |
| バージョン更新(コミットとタグも作成) | `npm version patch` / `npm version minor` / `npm version major` |
| バージョン更新をプッシュ | `git push origin HEAD --follow-tags` |
| テンプレートの設定 | `git config commit.template .gitmessage` |

コミットメッセージの書き方は [git-conventions.md](git-conventions.md)。

## 4. よくある困りごと

| 症状 | 対処 |
|---|---|
| ポートが使用中(8787 / 5173) | 起動中のプロセスを終了する。Windows: `netstat -ano \| findstr 8787` → `taskkill /PID <番号> /F` |
| `wrangler dev` が `dist` がないと止まる | `npm run dev:api` を使う(自動で作成)。直接なら `mkdir dist` |
| 型エラーが出る | `npm run typecheck` の出力で該当ファイルを確認 |
| 画面が古いまま(Service Worker のキャッシュ) | 画面右上の「更新」、またはブラウザの開発者ツール > Application > Service Workers で Unregister |
