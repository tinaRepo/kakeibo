# ドキュメント

| 資料 | 内容 |
|---|---|
| [cloudflare-setup.md](cloudflare-setup.md) | 環境構築ガイド(検証 dev / 本番 production / ローカル) |
| [admin-auth.md](admin-auth.md) | 管理者ログイン(パスワード + 確認コード)の設定と使い方 |
| [cloudflare-access.md](cloudflare-access.md) | (独自ドメインを取得したら)Cloudflare Access の設定 |
| [deploy-cicd.md](deploy-cicd.md) | GitHub Actions による自動デプロイ(develop → dev、main → production) |
| [commands.md](commands.md) | コマンド一覧(npm / wrangler / git) |
| [git-conventions.md](git-conventions.md) | コミットメッセージ(feat / fix / docs など)とブランチの運用ルール |
| [device-checklist.md](device-checklist.md) | 実機での動作確認チェックリスト |
| [design-notes.md](design-notes.md) | デザインの適用メモ |

初めて環境を作る順番: ① cloudflare-setup.md → ② admin-auth.md(管理者ログインの秘密)→ ③ deploy-cicd.md(自動デプロイを使う場合)
