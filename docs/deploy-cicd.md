# 自動デプロイ(GitHub Actions)

| ブランチ | デプロイ先 | 中身 |
|---|---|---|
| `develop` | 検証環境(dev) | 型チェック → ビルド → テスト → DBマイグレーション → デプロイ |
| `main`(または `master`) | 本番環境(production) | 同上(GitHub の Environments で承認を必須にもできる) |
| その他(`feature/*` など) | デプロイしない | プルリクエストで型チェックとビルドだけ実行(`ci.yml`) |

設定ファイル: `.github/workflows/deploy.yml`(デプロイ)/ `.github/workflows/ci.yml`(検証)。どちらも、型チェック・ビルドに加えて自動テスト(`npm test`)を実行し、失敗するとデプロイされません。

## 1. 最初に1回だけ行う準備

### 1.1 Cloudflare の API トークンを作る
1. Cloudflare ダッシュボード右上のアイコン > **My Profile** > **API Tokens** > **Create Token**。
2. テンプレート **Edit Cloudflare Workers** を選ぶ(これが基本)。
3. 次の権限が入っていることを確認し、足りなければ追加する。

   | 区分 | 項目 | 権限 | 用途 |
   |---|---|---|---|
   | Account | Workers Scripts | Edit | Worker のデプロイ |
   | Account | D1 | Edit | マイグレーション |
   | Account | Workers R2 Storage | Edit | R2 を使う Worker のデプロイ |
   | Account | Account Settings | Read | アカウント情報の参照 |

   - 独自ドメインを使わない間は、Zone の権限は**不要**です(ドメインを取得して `routes` を使うときに、Workers Routes と DNS の Edit を追加します)。
4. 作成後に表示される**トークンを控える**(再表示できない)。

### 1.2 アカウント ID を控える
ダッシュボードの **Workers & Pages** の概要ページの右側にある **Account ID**。

### 1.3 GitHub に登録する
リポジトリの **Settings > Secrets and variables > Actions > New repository secret** で2つ登録する。

| 名前 | 値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1.1 のトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 1.2 のアカウント ID |

### 1.3b(任意)本番デプロイの前に承認を必須にする
**Settings > Environments** で `production` を作り、**Required reviewers** に自分を追加する。以後、`main` への push 後、承認するまで本番にデプロイされない。`dev` も作っておくと、ワークフローの `environment: dev` と対応する(承認は不要)。

### 1.4 Cloudflare 側の準備
[cloudflare-setup.md](cloudflare-setup.md) の 3.1〜3.6(D1・R2・通知の鍵・管理者ログインの秘密・Turnstile)を、dev と production のそれぞれで済ませておく。
- 秘密(`VAPID_PRIVATE_KEY` / `TURNSTILE_SECRET`)は `wrangler secret put` で1回登録すれば、デプロイしても消えない。
- `wrangler.toml` の `database_id` などを書き換えて、コミットしておく。

### 1.5 ブランチを用意する
```bash
git checkout -b develop
git push -u origin develop       # → 検証環境へ自動デプロイ
```
`main`(または `master`)は、リポジトリの既定のブランチを使う。

## 2. 日々の流れ

```
feature/xxx ──PR──▶ develop ──(自動)──▶ 検証環境で確認
                       │
                       └──PR──▶ main ──(自動・承認あり)──▶ 本番環境
```
1. `develop` から `feature/xxx` を作って開発し、プルリクエストを出す(`ci.yml` が走る)。
2. `develop` にマージ → **検証環境に自動デプロイ**。実機で確認する。
3. 問題なければ `develop` → `main` のプルリクエストをマージ → **本番に自動デプロイ**。
4. 緊急の修正は `hotfix/xxx` を `main` から作り、`main` にマージ。そのあと `develop` にも取り込む。

コミットメッセージとブランチ名の決め方は [git-conventions.md](git-conventions.md)。

## 3. DB の変更(マイグレーション)
- `migrations/` に**新しい番号の SQL を追加**する(例 `0003_xxx.sql`)。既存のファイルは書き換えない。
- デプロイのたびに、未適用の分だけ自動で適用される(`wrangler d1 migrations apply`)。
- 先に develop で適用されて問題がないことを確認してから、main へ進める。
- 失敗するとデプロイは止まり、Worker は更新されない(ワークフローのログで確認)。

## 4. 手動でデプロイしたいとき
```bash
npm run deploy:dev       # 検証
npm run deploy:prod      # 本番(マイグレーションは npm run db:migrate:prod を先に)
```
GitHub の **Actions** タブから、ワークフローの再実行(Re-run)もできる。

## 5. 元に戻したいとき
```bash
npx wrangler rollback --env production    # 直前のバージョンに戻す(コードのみ。DBは戻らない)
```
DB のスキーマを元に戻す場合は、逆向きのマイグレーションを新しい番号で追加する。

## 6. 別の方法: Cloudflare の Workers Builds(GitHub連携)
GitHub Actions の代わりに、Cloudflare 側で Git 連携してビルド・デプロイする方法もあります。環境ごとに Worker を作り、同じリポジトリを接続します。

| Worker | 接続するブランチ | ビルドコマンド | デプロイコマンド |
|---|---|---|---|
| `kakeibo-dev` | `develop` | `npm ci && npm run build` | `npx wrangler d1 migrations apply DB --remote --env dev && npx wrangler deploy --env dev` |
| `kakeibo` | `main` | `npm ci && npm run build` | `npx wrangler d1 migrations apply DB --remote --env production && npx wrangler deploy --env production` |

設定場所: Workers & Pages > 対象の Worker > **Settings > Builds**。どちらか一方の方法だけを使ってください(両方を有効にすると二重にデプロイされます)。

## 7. うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| `Authentication error` / `10000` | `CLOUDFLARE_API_TOKEN` の権限不足。1.1 の表を確認 |
| `database_id` に関するエラー | `wrangler.toml` の `REPLACE_WITH_…` が残っている |
| workers.dev のサブドメインに関するエラー | アカウントに workers.dev のサブドメインが未登録。一度、手元で `npm run deploy:dev` を実行して登録する(または、ダッシュボードの Workers & Pages で登録) |
| マイグレーションで `table ... already exists` | 手動で作ったテーブルがある。`wrangler d1 migrations list` で状況を確認し、手動分を整理する |
| 本番デプロイが始まらない | Environments の承認待ち。Actions のページで承認する |
