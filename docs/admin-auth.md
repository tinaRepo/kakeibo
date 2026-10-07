# 管理者ログイン(パスワード + 確認コード)

管理者画面(`/admin`)を、運営者(自分)だけが開けるようにする認証です。**独自ドメインが不要**で、Cloudflare Access を使えない `*.workers.dev` で公開する場合に使います。

## 仕組み

- **パスワード**(12文字以上)と、認証アプリの **確認コード(6桁)** の2つで本人確認します(2段階認証)。
- ログインすると、署名つきのセッション Cookie(8時間有効。HttpOnly・SameSite=Strict)が発行されます。
- 失敗が続くと、一時的にログインできなくなります(同じIPは10分で5回まで、全体で1時間に20回まで)。確認コードは**1回しか使えません**(使い回し不可)。
- パスワードは Secrets に**ハッシュ**でだけ保存します(平文はどこにも置きません)。
- 設定がない場合、管理者 API は**すべて拒否**されます(安全側)。

## 1. 秘密を作る(環境ごとに1回)

dev と production で、**別の値**を作ります。

```bash
npm run admin:setup
```

1. 管理者パスワード(12文字以上)を2回入力する(画面には表示されません)。長く、他で使っていないものにしてください。
2. 画面に次の3つの値と、QR コードが表示されます。
   - `ADMIN_PASSWORD_HASH` … パスワードのハッシュ
   - `ADMIN_SESSION_SECRET` … ログイン Cookie の署名用の乱数
   - `ADMIN_TOTP_SECRET` … 確認コード(認証アプリ)の種
3. **QR コードを、認証アプリで読み取る**(Google Authenticator / Microsoft Authenticator / 1Password など)。読み取れないときは、手動入力で「キー: `ADMIN_TOTP_SECRET` の値」「種類: 時間ベース」を登録します。
4. 3つの値を、その環境の Secrets に登録する。
   ```bash
   npx wrangler secret put ADMIN_PASSWORD_HASH --env dev        # 本番: --env production
   npx wrangler secret put ADMIN_SESSION_SECRET --env dev
   npx wrangler secret put ADMIN_TOTP_SECRET --env dev
   ```
   各コマンドで値の入力を求められるので、画面に表示された値を貼り付けます(`$` を含みますが、そのまま貼り付けてください)。
5. 値は**どこにも保存しない**(パスワードマネージャーにパスワードだけ保存する)。QR コードは、登録後に閉じて構いません。

> `ADMIN_TOTP_SECRET` を登録しなければ、確認コードなしのパスワードだけでログインできます。ただし、インターネットに公開される画面なので、**登録することを強くおすすめします**。

## 2. ログインする

1. `https://kakeibo.<サブドメイン>.workers.dev/admin` を開く。
2. 管理者パスワードと、認証アプリに表示されている6桁の確認コードを入力して「ログイン」。
3. 終わったら、ヘッダの「ログアウト」。

## 3. 変更・やり直し

| やること | 方法 |
|---|---|
| パスワードを変える | `npm run admin:setup` をやり直し、3つの値を登録し直す(以前のログインはすべて無効になる) |
| スマホを変える・認証アプリを消した | `npm run admin:setup` をやり直し、新しい QR を登録する |
| 全員(自分の他の端末)をログアウトさせたい | `ADMIN_SESSION_SECRET` だけを新しい値にして登録し直す |
| 確認コードが通らない | スマホの時刻を自動設定にする。同じコードは1回しか使えないので、次のコードを待つ |

## 4. ローカル開発

ローカルでは、`.dev.vars` に `ADMIN_DEV_BYPASS=true` を書くと、localhost に限りログインを省略できます(本番のホスト名では無効)。パスワードログインを試したいときは、`.dev.vars` に3つの値を書き、`ADMIN_DEV_BYPASS` を外します。

## 5. 独自ドメインを取得したら

[cloudflare-access.md](cloudflare-access.md) の手順で Cloudflare Access も追加できます。Access を通った場合も、管理者ログインでも、どちらでも管理者画面に入れます。
