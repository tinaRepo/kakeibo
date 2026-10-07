# Git の運用ルール

## 1. コミットメッセージ(Conventional Commits)

```
<type>(<scope>): <subject>

<body>(任意)

<footer>(任意)
```

例: `feat(web): 明細の編集モーダルに削除ボタンを追加`

### type(種類)

| type | 使う場面 | 例 |
|---|---|---|
| `feat` | 新機能の追加 | `feat(web): CSVの取り込みを追加` |
| `fix` | バグ修正 | `fix(worker): 統合後のカテゴリID付け替えが効かない問題を修正` |
| `docs` | ドキュメントのみの変更 | `docs: Cloudflare Access の設定手順を追加` |
| `style` | 動作に影響しない見た目・整形(空白、セミコロン、CSS の微調整など) | `style(web): セレクトの矢印を枠内に移動` |
| `refactor` | 機能を変えないコードの整理 | `refactor(web): 明細の編集モーダルを共通化` |
| `perf` | 性能の改善 | `perf(worker): 集計のクエリを1回にまとめる` |
| `test` | テストの追加・修正 | `test(worker): CSV取込の異常系を追加` |
| `build` | ビルド・依存関係(`package.json`、`vite.config.ts` など) | `build(deps): dexie を 4.4 に更新` |
| `ci` | CI/CD の設定(`.github/workflows`) | `ci: develop への push で検証環境へデプロイ` |
| `chore` | 上記に当てはまらない雑務(設定ファイル、スクリプトなど) | `chore: .gitignore に .dev.vars を追加` |
| `revert` | 以前のコミットの取り消し | `revert: feat(web): CSVの取り込みを追加` |

### scope(影響範囲。任意)
このリポジトリでの目安: `web`(利用者の画面)/ `admin`(管理者画面)/ `worker`(API)/ `offline`(端末内DBと同期)/ `db`(マイグレーション)/ `docs` / `ci` / `deps`

### subject(1行目)の書き方
- 50文字程度まで。末尾に「。」は付けない。
- 「何をしたか」を簡潔に(例: 〜を追加 / 〜を修正 / 〜を変更)。
- 1コミット = 1つの目的。無関係な変更は分ける。

### body / footer
- body: 「なぜ変えたか」「どう変えたか」を書く(必要なときだけ)。
- 破壊的変更(互換性がなくなる変更)は、footer に `BREAKING CHANGE: 説明` を書くか、type の後ろに `!` を付ける(例 `feat(worker)!: ...`)。
- Issue との紐づけ: `Closes #12`。

テンプレートを使う場合(1回だけ設定):
```bash
git config commit.template .gitmessage
```

## 2. ブランチ

| ブランチ | 役割 | デプロイ先 |
|---|---|---|
| `main`(または `master`) | 本番のコード。直接コミットしない | 本番 |
| `develop` | 次のリリースに入れる変更の集約 | 検証 |
| `feature/<内容>` | 新機能(`develop` から作る) | なし |
| `fix/<内容>` | 通常のバグ修正(`develop` から作る) | なし |
| `hotfix/<内容>` | 本番の緊急修正(`main` から作る) | なし |
| `docs/<内容>` / `chore/<内容>` | ドキュメント・雑務 | なし |

ブランチ名の例: `feature/csv-import`、`fix/budget-validation`、`hotfix/login-error`(英小文字とハイフン)。

## 3. 開発の流れ

```bash
git checkout develop && git pull
git checkout -b feature/csv-import          # 1. ブランチを作る
# ... 編集 ...
git add -p                                  # 2. 変更を確認しながらステージ
git commit                                  # 3. メッセージは上のルールで
git push -u origin feature/csv-import       # 4. プッシュ → プルリクエスト(develop 向け)
```
- マージ方法は **Squash and merge**(1つのプルリクエスト = 1コミット)を推奨。その場合、プルリクエストのタイトルを `type(scope): subject` の形にする。
- `develop` へのマージで検証環境に、`main` へのマージで本番に自動デプロイされる([deploy-cicd.md](deploy-cicd.md))。

## 4. バージョンとリリース
`package.json` のバージョンを基準にし、次のコマンドで更新する。`package.json` と `package-lock.json` が更新され、バージョン更新のコミットと `v<バージョン>` タグが作られる。実行前に作業ツリーをクリーンにする。
```bash
npm version patch  # 修正: 1.0.0 -> 1.0.1
npm version minor  # 機能追加: 1.0.0 -> 1.1.0
npm version major  # 破壊的変更: 1.0.0 -> 2.0.0
git push origin HEAD --follow-tags
```
バージョンは `major.minor.patch` 形式。初回リリースは `1.0.0` とし、互換性が壊れる変更は major、機能追加は minor、修正は patch を上げる。

## 5. やってはいけないこと
- `main` / `develop` への force push、直接コミット。
- 秘密(`.dev.vars`、API トークン、VAPID の秘密鍵、パスワード)のコミット。`.gitignore` に入っていることを確認する。
- 適用済みのマイグレーション SQL の書き換え(新しい番号で追加する)。
