import type { Env } from './env'

// Turnstile: サイトキーも秘密鍵も未設定なら使わない。サイトキーだけ設定して秘密鍵がない(設定ミス)場合は、素通りさせず拒否する
export async function turnstileOk(env: Env, token: unknown, ip: string) {
  if (!env.TURNSTILE_SECRET) return !env.TURNSTILE_SITE_KEY
  if (typeof token !== 'string' || !token) return false
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) })
    return !!((await r.json()) as any).success
  } catch { return false }
}
// レート制限(固定ウィンドウ・D1)
export async function rateLimited(db: D1Database, key: string, max: number, windowSec: number) {
  const t = Date.now(), row = await db.prepare('SELECT n, reset_at FROM rate_limits WHERE k = ?').bind(key).first<any>()
  if (!row || row.reset_at < t) {
    await db.prepare('INSERT INTO rate_limits(k, n, reset_at) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n = 1, reset_at = excluded.reset_at').bind(key, t + windowSec * 1000).run()
    return false
  }
  if (row.n >= max) return true
  await db.prepare('UPDATE rate_limits SET n = n + 1 WHERE k = ?').bind(key).run()
  return false
}

// 「失敗した試行」だけを数える制限(正しく入力できた人は巻き込まれない)
export async function failCount(db: D1Database, key: string) {
  const row = await db.prepare('SELECT n, reset_at FROM rate_limits WHERE k = ?').bind(key).first<any>()
  return row && row.reset_at >= Date.now() ? (row.n as number) : 0
}
export async function recordFail(db: D1Database, key: string, windowSec: number) {
  const t = Date.now(), reset = t + windowSec * 1000
  await db.prepare('INSERT INTO rate_limits(k, n, reset_at) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset_at < ? THEN 1 ELSE n + 1 END, reset_at = CASE WHEN reset_at < ? THEN ? ELSE reset_at END').bind(key, reset, t, t, reset).run()
}
export const clearFails = (db: D1Database, key: string) => db.prepare('DELETE FROM rate_limits WHERE k = ?').bind(key).run()
