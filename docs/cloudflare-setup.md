# Cloudflare 環境構築ガイド(検証 dev / 本番 production / ローカル)

このアプリを Cloudflare 上に **検証環境(dev)** と **本番環境(production)** として別々に立てる手順と、ローカルで動かす手順をまとめた資料です。設定の実体は `wrangler.toml` にあります。

---

## 1. 全体像

| | ローカル | 検証 dev | 本番 production |
|---|---|---|---|
| wrangler の指定 | (なし) | `--env dev` | `--env production` |
| Worker名 | (デプロイしない) | `kakeibo-dev` | `kakeibo` |
| URL | http://localhost:5173 | `https://kakeibo-dev.<サブドメイン>.workers.dev` | `https://kakeibo.<サブドメイン>.workers.dev` |
| D1(DB) | 端末内(`.wrangler/`) | `kakeibo-dev` | `kakeibo-prod` |
| R2(画像) | 端末内(エミュレート) | `kakeibo-receipts-dev` | `kakeibo-receipts-prod` |
| 管理者の認証 | `.dev.vars` で省略(localhostのみ) | 管理者ログイン(パスワード+確認コード) | 管理者ログイン(パスワード+確認コード) |
| Turnstile | 未設定(確認なし)または公式テストキー | 任意(使うなら専用ウィジェット) | 推奨(本物のウィジェット) |
| Web Push 鍵(VAPID) | 任意 | dev専用の鍵 | 本番専用の鍵 |
| Cron | `--test-scheduled` で手動実行 | 15分ごと | 5分ごと |
| データ | 手元だけ | 検証用(本番と共有しない) | 実データ |

**守ること**
- dev と production で、**DB・R2・鍵(VAPID・管理者ログインの秘密)・Turnstile を共有しない**(データ混在や、通知・認証の取り違えを防ぐため)。
- `wrangler.toml` の bindings(D1/R2)と `[vars]` は**環境に継承されません**。環境ごとに全部書いてあります(書き忘れると、その環境だけ動きません)。
- `ADMIN_DEV_BYPASS` は本番・検証には**絶対に設定しない**(`.dev.vars` だけで使う。localhost以外では無効になる作りですが、念のため)。
- **独自ドメインは不要です**(`*.workers.dev` で公開します)。管理者画面は、独自ドメインが必要な Cloudflare Access ではなく、**管理者ログイン(パスワード+確認コード)**で守ります([admin-auth.md](admin-auth.md))。ドメインを取得したら、Access を追加することもできます([cloudflare-access.md](cloudflare-access.md))。

---

## 2. 事前準備(最初の1回)

1. Cloudflare アカウント(無料プランで可)。独自ドメインは**不要**です。
2. Node.js 20 以上、`npm install` 済み。
3. `npx wrangler login`(ブラウザでログイン)。`npx wrangler whoami` で確認。
4. 初回のデプロイ時に、**workers.dev のサブドメイン**(アカウント共通。例 `myname.workers.dev`)の登録を求められます。好きな名前を入力してください(あとから Workers & Pages の画面でも確認できます)。

---

## 3. 環境ごとの構築手順

dev と production で**同じ手順を2回**行います。以下は dev のコマンドで、production は `--env production` / `-prod` に読み替えます(コマンドは 3.9 にまとめて載せています)。

### 3.1 D1(データベース)を作る
```bash
npx wrangler d1 create kakeibo-dev        # 本番: kakeibo-prod
```
出力された `database_id` を `wrangler.toml` の `[[env.dev.d1_databases]]`(本番は `[[env.production.d1_databases]]`)の `database_id` に記入する。

### 3.2 R2(画像の保存先)を作る
```bash
npx wrangler r2 bucket create kakeibo-receipts-dev     # 本番: kakeibo-receipts-prod
```
バケットは非公開のまま(公開設定にしない)。画像は Worker が認証したうえで配信します。

### 3.3 マイグレーション(テーブルの作成)
```bash
npm run db:migrate:dev     # 本番: npm run db:migrate:prod
```
`migrations/` の SQL を番号順に適用します(適用済みの分は自動でスキップされます)。CI/CD を使う場合は、デプロイのたびに自動で実行されます([deploy-cicd.md](deploy-cicd.md))。

### 3.4 Web Push の鍵(VAPID)を作る
環境ごとに**別の鍵**を作ります。
```bash
npm run vapid              # 公開鍵と秘密鍵が表示される(dev用に1回、本番用にもう1回)
```
- 公開鍵 → `wrangler.toml` の `[env.dev.vars]` `VAPID_PUBLIC_KEY`
- 秘密鍵 → Secrets に登録(ファイルには書かない)
```bash
npx wrangler secret put VAPID_PRIVATE_KEY --env dev    # 本番: --env production
```
- `VAPID_SUBJECT` は連絡先の `mailto:` に変更する。

### 3.5 管理者ログインの秘密を作る
管理者画面(`/admin`)のパスワードと確認コードを作ります。**環境ごとに別の値**にします。
```bash
npm run admin:setup
```
パスワード(12文字以上)を2回入力すると、3つの値(`ADMIN_PASSWORD_HASH` / `ADMIN_SESSION_SECRET` / `ADMIN_TOTP_SECRET`)と、認証アプリ用の QR コードが表示されます。値を Secrets に登録します。
```bash
npx wrangler secret put ADMIN_PASSWORD_HASH --env dev       # 本番: --env production
npx wrangler secret put ADMIN_SESSION_SECRET --env dev
npx wrangler secret put ADMIN_TOTP_SECRET --env dev
```
詳しくは [admin-auth.md](admin-auth.md)。**この3つを登録しないと、管理者画面にはログインできません**(安全側の動作)。

### 3.6 Turnstile(スパム対策。任意だが本番は推奨)
1. ダッシュボード > Turnstile > Add widget。ドメインに、その環境のホスト名(例 `kakeibo.myname.workers.dev`)を入れる。
2. サイトキー → `wrangler.toml` の `TURNSTILE_SITE_KEY`、秘密鍵 → Secrets:
```bash
npx wrangler secret put TURNSTILE_SECRET --env production    # dev: --env dev
```
- **サイトキーと秘密鍵は両方セットで設定してください。** サイトキーだけ設定して秘密鍵を登録し忘れると、設定ミスとして、登録・ログインが**すべて拒否**されます。
- 使わない場合は、両方とも設定しないままにします(確認なしで動きます)。
- 試すだけなら、公式テストキー(サイトキー `1x00000000000000000000AA` / 秘密鍵 `1x0000000000000000000000000000000AA`。常に成功)も使えます。

### 3.7 公開 URL を確認する
デプロイすると、`https://kakeibo-dev.<サブドメイン>.workers.dev`(本番は `https://kakeibo.<サブドメイン>.workers.dev`)で開けます。`wrangler.toml` の `workers_dev = true` が、この URL での公開を有効にしています。
- 独自ドメインを使いたくなったら、`wrangler.toml` の `routes` のコメントを外します(Access も使えるようになります)。

### 3.8 デプロイ
```bash
npm run deploy:dev         # 本番: npm run deploy:prod(ビルド → デプロイ)
```
デプロイ後、Cron(`[env.*.triggers]`)も有効になります。

### 3.9 コマンド早見表

| やること | dev | production |
|---|---|---|
| D1 作成 | `npx wrangler d1 create kakeibo-dev` | `npx wrangler d1 create kakeibo-prod` |
| R2 作成 | `npx wrangler r2 bucket create kakeibo-receipts-dev` | `npx wrangler r2 bucket create kakeibo-receipts-prod` |
| マイグレーション | `npm run db:migrate:dev` | `npm run db:migrate:prod` |
| 適用状況の確認 | `npx wrangler d1 migrations list DB --remote --env dev` | `… --env production` |
| 秘密の登録 | `npx wrangler secret put 名前 --env dev` | `… --env production` |
| 秘密の一覧 | `npx wrangler secret list --env dev` | `… --env production` |
| デプロイ | `npm run deploy:dev` | `npm run deploy:prod` |
| ログ(リアルタイム) | `npm run logs:dev` | `npm run logs:prod` |
| SQLの実行 | `npx wrangler d1 execute DB --remote --env dev --command "SELECT COUNT(*) FROM members"` | `… --env production …` |
| ロールバック | `npx wrangler rollback --env dev` | `npx wrangler rollback --env production` |

### 3.10 公開後の確認
- [ ] `https://<ホスト名>/` が開き、家計簿を作成できる
- [ ] `https://<ホスト名>/admin` で、管理者パスワードと確認コードでログインできる
- [ ] ログインせずに `/api/admin/stats` を開くと 403 になる
- [ ] 設定画面で通知を許可でき、管理者のお知らせ(通知あり)が届く(iOS はホーム画面に追加したアプリで)
- [ ] 画像を添付して表示できる(R2 のバケットが公開設定になっていない)
- [ ] `npm run logs:dev` / `logs:prod` でエラーが出ていない

---

> **ブランチと自動デプロイ**: `develop` ブランチへの push で dev、`main`(または `master`)への push で production に自動デプロイする設定は [deploy-cicd.md](deploy-cicd.md) にあります。この資料の 3.8 は手動でデプロイする場合の手順です。

---

## 4. 運用の流れ

1. 変更は**まず dev にデプロイして確認**してから、production へ。
2. DB スキーマの変更は、`migrations/` に**新しい番号のSQLを追加**する(既存のSQLは書き換えない)。`db:migrate:dev` → 動作確認 → `db:migrate:prod` の順に適用する。CI/CD ならデプロイ時に自動で適用される。
3. 秘密(`VAPID_PRIVATE_KEY` / `TURNSTILE_SECRET`)を変えたら、その環境を再デプロイしなくても `secret put` で反映される。VAPID 鍵を変えると、既存の通知登録は無効になる(利用者が再度「通知を受け取る」を押す必要がある)。
4. 本番の DB を触る前に、バックアップとして書き出す: `npx wrangler d1 export DB --remote --env production --output backup.sql`。

---

## 5. ローカルで動かす場合(同じ設定ファイルで)

ローカルは `wrangler.toml` の**トップレベル**の設定を使い、DB・画像は手元の `.wrangler/` に作られます(Cloudflare上のリソースは不要)。

```bash
npm install
npm run db:migrate         # ローカルDBを作成(.wrangler/ 配下。migrations/ を適用)
cp .dev.vars.example .dev.vars   # Windowsは copy。必要なら中身を編集
npm run dev:api            # ターミナル1: API(http://localhost:8787)
npm run dev                # ターミナル2: 画面(http://localhost:5173)← こちらを開く
```

- **管理者画面**: `.dev.vars` に `ADMIN_DEV_BYPASS=true` がある間、localhost に限りログインなしで `http://localhost:5173/admin` が開ける。
- **Turnstile**: `.dev.vars` に何も書かなければ確認なし。試すなら公式テストキー(`TURNSTILE_SITE_KEY=1x00000000000000000000AA` / `TURNSTILE_SECRET=1x0000000000000000000000000000000AA`)。
- **プッシュ通知**: `npm run vapid` の2つの値を `.dev.vars` に書く。ローカルでは配信先(FCM/APNs)への実際の送信は確認しづらいので、通知は dev 環境で確認するのがおすすめ。
- **Cron**: `npm run dev:api` を `npx wrangler dev --test-scheduled` で起動し、`http://localhost:8787/cdn-cgi/handler/scheduled` を開くと1回実行できる。
- **PWA・Service Worker**: `npm run dev` では無効。確認したいときは `npm run build` のあと `npx wrangler dev`(http://localhost:8787)で開く。
- **カメラ(QR読み取り)・通知**: HTTPS が必要。`localhost` は例外として使えるが、スマホの実機確認は dev 環境(HTTPS)で行う。
- **ローカルDBを作り直す**: `.wrangler/` フォルダを削除 → `npm run db:migrate`。
- **環境を指定してローカル実行**したいとき(その環境の変数を試す): `npx wrangler dev --env dev`。このとき変数は `.dev.vars.dev`(`.dev.vars.<環境名>`)から読まれ、DB・R2 は**環境名つきの別のローカル領域**になる。

---

## 6. トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| `wrangler dev` が「assets.directory が存在しない」で止まる | `npm run dev:api` は空の `dist` を自動で作る。直接 `wrangler dev` する場合は先に `npm run build` か `mkdir dist` |
| デプロイ後に API が 500 / 「no such table」 | その環境に `db:migrate:dev` / `db:migrate:prod` を実行していない(CI/CDなら、ワークフローのログでマイグレーションの失敗を確認) |
| 特定の環境だけ DB や R2 に繋がらない | `[env.○○]` に `d1_databases` / `r2_buckets` / `vars` を書き忘れている(継承されない) |
| 管理者画面に「パスワードが設定されていません」と出る | `ADMIN_PASSWORD_HASH` と `ADMIN_SESSION_SECRET` を、その環境の Secrets に登録していない(3.5) |
| 管理者ログインで確認コードが通らない | スマホの時刻のずれ(自動設定にする)。同じコードは1回しか使えないので、次のコードを待つ。環境の取り違え(dev の QR を本番に使う等) |
| 管理者ログインが「しばらくログインできません」 | 失敗が続いた制限(同じIPは10分で5回まで)。時間をおく |
| 通知が来ない | `VAPID_PUBLIC_KEY`(vars)と `VAPID_PRIVATE_KEY`(secret)が同じ鍵ペアか。iOS はホーム画面アプリか。鍵を変えたあと再登録したか |
| 登録・ログインがすべて拒否される | Turnstile のサイトキーだけ設定して、`TURNSTILE_SECRET` を登録していない(両方セットで設定する)。または、ウィジェットのドメインが実際のホスト名と合っていない |
| ログインで `Error 1102`(CPU時間超過)が出る | パスワード照合(PBKDF2)が、無料プランの CPU 時間の上限を超えている。Workers の有料プラン(月額$5〜)にすると解消する |
| 予約お知らせが届かない | Cron が有効か(デプロイ後)。dev は15分間隔。`npm run logs:dev` で確認 |
| 一度作った D1 を消したい | `npx wrangler d1 delete kakeibo-dev`(復元できないので注意) |
