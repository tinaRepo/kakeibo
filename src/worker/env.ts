export type Env = {
  DB: D1Database
  RECEIPTS: R2Bucket
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ADMIN_DEV_BYPASS?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  TURNSTILE_SECRET?: string
  TURNSTILE_SITE_KEY?: string
  ADMIN_PASSWORD_HASH?: string // 管理者のパスワード(PBKDF2ハッシュ)。npm run admin:setup で生成
  ADMIN_SESSION_SECRET?: string // 管理者ログインのCookie署名用
  ADMIN_TOTP_SECRET?: string // 管理者の確認コード(認証アプリ用。推奨)
}
