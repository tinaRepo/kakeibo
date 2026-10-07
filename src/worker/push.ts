import { buildPushPayload } from '@block65/webcrypto-web-push'
import type { Env } from './env'

type Sub = { id: number; endpoint: string; p256dh: string; auth: string }
export type PushData = { title: string; body: string; url: string; tag?: string }

// Web Push(VAPID・本文暗号化)。'gone' は購読が無効(削除する)
async function sendPush(env: Env, s: Sub, data: PushData): Promise<'ok' | 'gone' | 'error'> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 'error'
  try {
    const req = await buildPushPayload(
      { data: JSON.stringify(data), options: { ttl: 3600, urgency: 'normal' } },
      { endpoint: s.endpoint.replace(/^http:/, 'https:'), /* httpはローカル開発のモック宛てのみ(登録時に検証済み) */ expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
      { subject: env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY })
    const res = await fetch(s.endpoint, req)
    return res.status === 404 || res.status === 410 ? 'gone' : res.ok ? 'ok' : 'error'
  } catch (e) { console.error('push failed', e); return 'error' }
}
export async function pushTo(env: Env, subs: Sub[], data: PushData) {
  await Promise.all(subs.map(async s => {
    if ((await sendPush(env, s, data)) === 'gone') await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run() // 無効な通知先を削除
  }))
}
const COLS = 'p.id, p.endpoint, p.p256dh, p.auth'
export async function notifyReply(env: Env, memberId: string, inquiryId: number | string, body = '問い合わせに返信がありました') {
  const subs = (await env.DB.prepare(`SELECT ${COLS} FROM push_subscriptions p WHERE p.member_id = ? AND p.notify_reply = 1`).bind(memberId).all()).results as any[]
  await pushTo(env, subs, { title: '家計簿', body, url: '/inquiries/' + inquiryId, tag: 'reply-' + inquiryId })
}
export async function pushAnnouncement(env: Env, a: { id: number; title: string; target: string }) {
  const claim = await env.DB.prepare('UPDATE announcements SET pushed_at = ? WHERE id = ? AND pushed_at IS NULL').bind(new Date().toISOString(), a.id).run()
  if (claim.meta.changes !== 1) return // 二重配信しない
  const subs = (await env.DB.prepare(`SELECT ${COLS} FROM push_subscriptions p JOIN members m ON m.id = p.member_id WHERE p.notify_announce = 1 AND m.status = 'active' AND (? = 'all' OR m.role = ?)`).bind(a.target, a.target).all()).results as any[]
  await pushTo(env, subs, { title: 'お知らせ', body: a.title, url: '/announcements', tag: 'ann-' + a.id })
}
export async function notifyBudget(env: Env, ledgerId: string, body: string, tag: string) {
  const subs = (await env.DB.prepare(`SELECT ${COLS} FROM push_subscriptions p JOIN members m ON m.id = p.member_id WHERE m.ledger_id = ? AND m.notify_budget = 1 AND m.status = 'active'`).bind(ledgerId).all()).results as any[]
  await pushTo(env, subs, { title: '予算', body, url: '/', tag }) // 金額は含めない
}
export async function hasBudgetSubscribers(env: Env, ledgerId: string) {
  return !!(await env.DB.prepare(`SELECT 1 x FROM push_subscriptions p JOIN members m ON m.id = p.member_id WHERE m.ledger_id = ? AND m.notify_budget = 1 AND m.status = 'active' LIMIT 1`).bind(ledgerId).first())
}
