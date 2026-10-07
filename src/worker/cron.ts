import type { Env } from './env'
import { checkBudgets } from './budget'
import { pushAnnouncement } from './push'

// Cron Triggers: 予約お知らせの配信 / 予算超過の確認 / 期限切れデータの掃除 / R2の残骸の掃除
export async function runCron(env: Env) {
  const db = env.DB, t = new Date().toISOString(), DAY = 864e5
  for (const a of (await db.prepare('SELECT id, title, target FROM announcements WHERE send_push = 1 AND pushed_at IS NULL AND publish_at <= ?').bind(t).all()).results as any[]) await pushAnnouncement(env, a)
  for (const l of (await db.prepare(`SELECT DISTINCT ledger_id FROM members WHERE notify_budget = 1 AND status = 'active'`).all()).results as any[]) await checkBudgets(env, l.ledger_id)
  const old = new Date(Date.now() - DAY).toISOString()
  await db.batch([
    db.prepare('DELETE FROM device_links WHERE expires_at < ?').bind(old),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM merge_category_map WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(Date.now()),
    db.prepare(`DELETE FROM push_subscriptions WHERE member_id NOT IN (SELECT id FROM members WHERE status = 'active')`),
  ])
  // DBに記録のないR2オブジェクト(アップロード途中の失敗など)を、1回500件ずつ巡回して削除
  const cur = (await db.prepare(`SELECT v FROM system_kv WHERE k = 'r2cursor'`).first<any>())?.v || undefined
  const l = await env.RECEIPTS.list({ limit: 500, cursor: cur })
  const keys = l.objects.filter(o => o.uploaded.getTime() < Date.now() - DAY).map(o => o.key)
  const orphans: string[] = []
  for (let i = 0; i < keys.length; i += 90) {
    const ch = keys.slice(i, i + 90)
    const known = new Set(((await db.prepare(`SELECT r2_key FROM receipts WHERE r2_key IN (${ch.map(() => '?').join(',')})`).bind(...ch).all()).results as any[]).map(r => r.r2_key))
    orphans.push(...ch.filter(k => !known.has(k)))
  }
  if (orphans.length) await env.RECEIPTS.delete(orphans)
  await db.prepare(`INSERT INTO system_kv(k, v) VALUES('r2cursor', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(l.truncated ? l.cursor : '').run()
}
