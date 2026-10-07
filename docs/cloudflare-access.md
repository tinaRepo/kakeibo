# Cloudflare Access の設定(管理者画面を自分だけに限定する)

> **この設定は、独自ドメインを取得したあとに行う「追加の保護」です(現在は不要)。** 独自ドメインがない間は、**管理者ログイン(パスワード+確認コード)**を使います([admin-auth.md](admin-auth.md))。Access も設定すると、管理者画面にたどり着く前の段階でも守られ、管理者ログインとどちらでも入れます。

管理者画面(`/admin`)と管理者用 API(`/api/admin/*`)を、**自分のメールアドレスだけ**が開けるようにする設定です。dev と production で、それぞれ1回ずつ行います。

> 画面の名称・配置は Cloudflare の更新で変わることがあります。ここでは「何を設定するか」と、その画面での探し方を書いています。

## 0. 仕組みを先に理解しておく

```
管理者のブラウザ ──▶ [Cloudflare Access] ──(ログイン済みなら通す)──▶ Worker
                        │                                          │
                        └ メールにワンタイムPINを送って本人確認        └ 通された印(Cf-Access-Jwt-Assertion)を
                                                                      Worker自身でも検証。なければ403
```

- **Access** は、アプリの手前に置く「受付」です。許可したメールの人だけが通れます。
- Worker 側でも、Access が付けた署名つきの印(JWT)を検証します。したがって、**Access の設定を間違えて穴が空いても、管理者 API は 403 になります**(二重の防御)。
- そのために Worker に2つの値を教える必要があります。
  - `ACCESS_TEAM_DOMAIN`: 自分のチーム名(例 `myteam.cloudflareaccess.com`)
  - `ACCESS_AUD`: Access アプリごとの識別子(AUD タグ)
- 保護するパスは **2つ**です(`/admin/*` と `/api/admin/*`)。`/api/*` 全体は保護**しません**(利用者のAPIも含まれてしまい、家計簿が使えなくなります)。

## 1. 前提

- Cloudflare アカウントがあり、公開に使う**独自ドメインが Cloudflare に登録済み**であること(`*.workers.dev` では、この手順の Access は使えません)。
- Worker を、そのドメインのホスト名(例 `kakeibo-dev.example.com`)で公開できていること(`wrangler.toml` の `routes` のコメントを外す。`workers_dev` は `false` にしてもよい)。

## 2. Zero Trust を有効にして、チーム名を決める(最初の1回だけ)

1. Cloudflare ダッシュボードにログインし、左のメニューから **Zero Trust** を開く(`https://one.dash.cloudflare.com/` からも開けます)。
2. 初めて開く場合は、**チーム名**(Team name)の入力を求められます。英数字で決めます(例 `myteam`)。
   - これが `myteam.cloudflareaccess.com` というチームのドメインになります。**あとから確認する場所**: Zero Trust > **Settings**(設定) > **General** > **Team domain**。
3. プランの選択で **Free**(無料。50ユーザーまで)を選びます。
   - 画面によっては支払い方法(クレジットカード)の登録を求められることがあります。無料プランの範囲なら課金はされません。

## 3. ログイン方法(Identity provider)を確認する

特別な設定は不要です。既定の **One-time PIN**(メールに届く6桁の確認コード)がそのまま使えます。

- Zero Trust > **Settings** > **Authentication** > **Login methods** に「One-time PIN」があることを確認します(なければ追加)。
- Google や GitHub でログインしたい場合は、ここに追加できます(必須ではありません)。

## 4. Access のアプリケーションを作る

dev と production で別々に作ります(**名前もホスト名も別**)。

1. Zero Trust > **Access controls**(または **Access**)> **Applications** を開き、**Add an application** を押す。
2. 種類は **Self-hosted** を選ぶ。
3. **Application name**: 分かりやすい名前(例 `kakeibo-dev-admin` / `kakeibo-prod-admin`)。
4. **Session Duration**(ログインの有効時間): `24 hours` など、好みの長さ。
5. **Public hostname**(保護する場所)を追加する。**2か所**登録します。

   | Subdomain | Domain | Path |
   |---|---|---|
   | `kakeibo-dev`(本番なら `kakeibo`) | `example.com` | `admin`(または `/admin/*`) |
   | `kakeibo-dev`(本番なら `kakeibo`) | `example.com` | `api/admin`(または `/api/admin/*`) |

   - 入力欄は「Subdomain / Domain / Path」に分かれていることが多いです。Path は、`admin` と書くと配下すべて(`/admin/...`)が対象になります。ワイルドカード(`*`)の入力欄の場合は `/admin/*` と書きます。画面の説明文に従ってください。
   - 画面が「Application domain + Path」の1行形式なら、`kakeibo-dev.example.com/admin` と `kakeibo-dev.example.com/api/admin` を追加します。
6. **Policies**(誰を通すか)を設定する。
   1. **Create new policy**(または Add a policy)。
   2. Policy name: `admin-only`。
   3. **Action**: `Allow`。
   4. **Include**(含める条件)で、selector に **Emails** を選び、**自分のメールアドレス**を入力する。
      - 複数人にするなら、メールを追加するか、`Emails ending in`(メールのドメイン)を使う。
   5. 保存してアプリケーションに紐づける。
7. **Login methods**(アプリで使うログイン方法)は、`One-time PIN` を選ぶ(または全て許可)。
8. 画面の最後で **Save / Add application** を押して保存する。

## 5. AUD タグを控えて、Worker に設定する

1. 作成したアプリケーションを開く(Applications の一覧でアプリ名をクリック)。
2. **Overview**(または Basic information)にある **Application Audience (AUD) Tag** をコピーする(長い16進の文字列)。
3. [Settings > General] で **Team domain** を確認する(例 `myteam.cloudflareaccess.com`)。
4. `wrangler.toml` の、その環境の `[env.dev.vars]`(本番は `[env.production.vars]`)に書く。

   ```toml
   [env.dev.vars]
   ACCESS_TEAM_DOMAIN = "myteam.cloudflareaccess.com"   # https:// は付けない
   ACCESS_AUD = "ここにdevアプリのAUDタグ"
   ```
5. デプロイし直す(`npm run deploy:dev` または Git に push)。

> **dev と production の AUD は別です。** 取り違えると、その環境の管理者 API が 403 になります。

## 6. 動作確認

1. **ブラウザのシークレットウィンドウ**で `https://kakeibo-dev.example.com/admin` を開く。
2. Cloudflare Access のログイン画面(`myteam.cloudflareaccess.com`)に切り替わる。
3. 許可したメールアドレスを入力し、届いた **6桁の PIN** を入力する(迷惑メールフォルダも確認)。
4. 管理者画面が開く。問い合わせ・メンバー検索などが表示されればOK。
5. 追加の確認(任意):
   - 別のメールアドレスを入力すると、ログインできない(拒否される)。
   - ターミナルから Access を通さず `curl -i https://kakeibo-dev.example.com/api/admin/stats` を実行すると、Access のログイン画面へのリダイレクト(302)か 403 が返る。データは返らない。

## 7. うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| `/admin` が Access を通らず、そのまま開く(または開けない) | アプリのホスト名・パスが違う。`/admin` が保護対象に入っているか、ホスト名がアクセスしている URL と一致しているか確認 |
| PIN のメールが届かない | 迷惑メールフォルダ。ポリシーに入れたメールと、入力したメールが一致しているか。数分待ってもう一度 |
| ログインできたが、管理者画面にエラー「管理者として認証されていません」 | `ACCESS_AUD` が違う、`ACCESS_TEAM_DOMAIN` が違う(`https://` を付けている等)、または**デプロイし直していない**。dev と production の取り違えもよくある |
| `/admin` は開くが、一覧が空・エラー | `/api/admin/*` が保護対象に入っていない、または AUD の不一致。ブラウザの開発者ツール(Network)で `/api/admin/...` のレスポンスを確認 |
| 一般の利用者の画面まで Access のログインが出る | 保護パスを広く設定しすぎ(`/*` や `/api/*`)。`/admin/*` と `/api/admin/*` だけにする |
| 自分が締め出された | Zero Trust > Access > Applications でポリシーのメールを確認。ログイン状態をやり直すには `https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/logout` を開く |

## 8. 補足

- **ローカル開発**では Access を使いません。`.dev.vars` に `ADMIN_DEV_BYPASS=true` を書くと、localhost に限り認証が省略されます(本番のホスト名では無効)。
- 管理者を増やしたいときは、ポリシーのメールを追加するだけです(Worker 側の変更は不要)。
- Access のログ(誰がいつ入ったか)は Zero Trust > **Logs** > **Access** で見られます。
