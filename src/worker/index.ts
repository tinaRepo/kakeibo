import { Hono, Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { verifyAccess } from './access'
import type { Env } from './env'
import { notifyReply, pushAnnouncement } from './push'
import { checkBudgets } from './budget'
import { clearFails, failCount, rateLimited, recordFail, turnstileOk } from './guard'
import { signAdminToken, verifyAdminToken, verifyTotp } from './admin'
import { runCron } from './cron'
import { hashPassword, normId, validLoginId, validPassword, verifyPassword } from './password'

type M = { id: string; ledger_id: string; role: 'owner' | 'user'; name: string; can_tx: number; can_category: number; can_sub: number; can_budget: number }
type C = { Bindings: Env; Variables: { m: M; admin: string } }
type Ctx = Context<C>

const app = new Hono<C>()
const DAY = 864e5, TTL = 30 * DAY
const isHttps = (c: Ctx) => new URL(c.req.url).protocol === 'https:'
const cname = (c: Ctx) => (isHttps(c) ? '__Host-session' : 'session')
const ckey = (c: Ctx) => getCookie(c, '__Host-session') || getCookie(c, 'session')
const EXP = ['食費', '日用品', '交通費', '光熱費', '通信費', '住居費', '医療費', '交際費', '娯楽', '衣服・美容', '教育', 'その他']
const INC = ['給与', '賞与', '副収入', '年金・手当', '投資収益', 'その他収入']
const EXP_ICON = ['🍽️', '🧴', '🚃', '💡', '📱', '🏠', '💊', '🥂', '🎮', '👕', '📚', '📦']
const INC_ICON = ['💴', '🎁', '💼', '🏦', '📈', '💰']
const iconOf = (v: any) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, 12).join('') : null)
const RCPT_MAX = 5, RCPT_BYTES = 1_000_000, LEDGER_QUOTA = 500 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const now = () => new Date().toISOString()
const devLabel = (ua: string) => {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '端末'
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : ''
  return br ? `${os} / ${br}` : os
}
const sha = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
const can = (m: M, k: 'can_tx' | 'can_category' | 'can_sub' | 'can_budget') => m.role === 'owner' || !!m[k]
const bg = (c: Ctx, p: Promise<unknown>) => { const q = p.catch(e => console.error(e)); try { c.executionCtx.waitUntil(q) } catch { /* 実行コンテキストなし */ } }
const ipOf = (c: Ctx) => c.req.header('CF-Connecting-IP') || 'local'
async function guard(c: Ctx, key: string, max: number, sec: number, token?: unknown, needToken = true) {
  if (await rateLimited(c.env.DB, `${key}:${ipOf(c)}`, max, sec)) return c.json({ error: 'しばらく時間をおいてからお試しください' }, 429)
  if (needToken && !(await turnstileOk(c.env, token, ipOf(c)))) return c.json({ error: '確認に失敗しました。もう一度お試しください' }, 403)
  return null
}
const err = (c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 415, error: string) => c.json({ error }, status)

async function startSession(c: Ctx, memberId: string, existing?: { token: string }) {
  const token = existing?.token ?? crypto.randomUUID() + crypto.randomUUID()
  if (!existing) {
    const t = now()
    await c.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), memberId, await sha(token), devLabel(c.req.header('User-Agent') || ''), t, t, new Date(Date.now() + TTL).toISOString()).run()
  }
  setCookie(c, cname(c), token, { httpOnly: true, secure: isHttps(c), sameSite: 'Lax', path: '/', maxAge: TTL / 1000 })
}

app.onError((e, c) => {
  console.error(e)
  const local = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname)
  return c.json({ error: 'サーバーでエラーが発生しました' + (local ? `: ${e.message}` : '') }, 500)
})

// CSRF: Origin検証 + JSONのみ
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const o = c.req.header('Origin')
    // ブラウザが付ける Sec-Fetch-Site を最優先(開発時のプロキシでHostが書き換わっても正しく判定できる)
    const sfs = c.req.header('Sec-Fetch-Site')
    if (sfs) { if (sfs !== 'same-origin' && sfs !== 'none') return err(c, 403, '不正なリクエストです') }
    else if (o && new URL(o).host !== (c.req.header('Host') || new URL(c.req.url).host)) return err(c, 403, '不正なリクエストです')
    if (!c.req.header('Content-Type')?.includes('application/json')) return err(c, 415, 'JSONのみ受け付けます')
  }
  await next()
})

// 認証
app.use('/api/*', async (c, next) => {
  const p = new URL(c.req.url).pathname
  if (p === '/api/ledgers' || p === '/api/join' || p.startsWith('/api/admin/') || p === '/api/config' || p === '/api/login' || p.startsWith('/api/admin-auth/')) return next()
  const tok = ckey(c)
  if (!tok) return err(c, 401, 'ログインが必要です')
  const r = await c.env.DB.prepare(
    `SELECT s.id sid, s.last_used_at, m.* FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND m.status = 'active'`).bind(await sha(tok), now()).first<any>()
  if (!r) return err(c, 401, 'ログインが必要です')
  if (Date.now() - Date.parse(r.last_used_at) > DAY) {
    await c.env.DB.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?').bind(now(), new Date(Date.now() + TTL).toISOString(), r.sid).run()
    await startSession(c, r.id, { token: tok })
  }
  c.set('m', r)
  await next()
})

app.post('/api/ledgers', async c => {
  const { name, turnstile, login_id, password } = await c.req.json<any>()
  const g = await guard(c, 'ledger', 10, 3600, turnstile); if (g) return g
  if (!name?.trim() || name.length > 30) return err(c, 400, '表示名を入力してください(30文字まで)')
  const loginId = normId(login_id)
  if (!validLoginId(loginId)) return err(c, 400, 'ログインIDは、英数字と . _ - の4〜32文字で入力してください')
  if (!validPassword(password)) return err(c, 400, 'パスワードは8〜128文字で入力してください')
  if (await c.env.DB.prepare('SELECT 1 x FROM members WHERE login_id = ?').bind(loginId).first()) return err(c, 409, 'このログインIDはすでに使われています')
  const passwordHash = await hashPassword(password)
  const lid = crypto.randomUUID(), mid = crypto.randomUUID(), code = 'O-' + crypto.randomUUID(), t = now(), db = c.env.DB
  const st = [
    db.prepare('INSERT INTO ledgers(id, created_at) VALUES(?,?)').bind(lid, t),
    db.prepare(`INSERT INTO members(id, ledger_id, role, name, code_hash, login_id, password_hash, can_tx, can_category, can_sub, can_budget, status, created_at) VALUES(?,?, 'owner', ?,?,?,?,1,1,1,1,'active',?)`).bind(mid, lid, name.trim(), await sha(code), loginId, passwordHash, t),
    ...EXP.map((n, i) => db.prepare(`INSERT INTO categories(ledger_id, type, name, icon, sort_order) VALUES(?, 'expense', ?, ?, ?)`).bind(lid, n, EXP_ICON[i], i)),
    ...INC.map((n, i) => db.prepare(`INSERT INTO categories(ledger_id, type, name, icon, sort_order) VALUES(?, 'income', ?, ?, ?)`).bind(lid, n, INC_ICON[i], i)),
  ]
  try { await db.batch(st) } catch (e: any) { if (/UNIQUE/i.test(String(e?.message))) return err(c, 409, 'このログインIDはすでに使われています'); throw e }
  await startSession(c, mid)
  return c.json({ code })
})

app.post('/api/join', async c => {
  const b = await c.req.json<any>()
  const code = String(b.code || '').trim()
  if (!/^[OUDH]-[0-9a-f-]{36}$/i.test(code)) return err(c, 400, 'コードの形式が正しくありません')
  const g = await guard(c, 'join', 20, 600, b.turnstile, !/^[DH]-/i.test(code)); if (g) return g // 総当たり対策(O-/U-はTurnstileも)
  if (/^[DH]-/i.test(code)) { // 端末追加コード(D-, 10分) / 引き継ぎトークン(H-, 24時間): どちらも1回限り
    const hash = await sha(code.toUpperCase().slice(0, 2) + code.slice(2)), purpose = /^D/i.test(code) ? 'device' : 'handoff'
    const used = await c.env.DB.prepare('UPDATE device_links SET used_at = ? WHERE code_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?').bind(now(), hash, purpose, now()).run()
    if (used.meta.changes !== 1) return err(c, 401, 'コードが正しくないか、期限が切れています')
    const dl = await c.env.DB.prepare('SELECT m.id, m.role, m.password_hash, m.login_id FROM device_links d JOIN members m ON m.id = d.member_id WHERE d.code_hash = ? AND m.status = \'active\'').bind(hash).first<any>()
    if (!dl) return err(c, 401, 'コードが正しくないか、期限が切れています')
    await startSession(c, dl.id)
    return c.json({ role: dl.role, needs_credentials: !dl.password_hash, login_id: dl.login_id ?? null })
  }
  const m = await c.env.DB.prepare('SELECT * FROM members WHERE code_hash = ?').bind(await sha(code)).first<any>()
  if (!m || m.status === 'revoked') return err(c, 401, 'コードが正しくありません')
  if (m.role === 'user' && m.status === 'pending') {
    if (!b.name?.trim()) return err(c, 400, '表示名を入力してください')
    await c.env.DB.prepare(`UPDATE members SET name = ?, status = 'active' WHERE id = ?`).bind(b.name.trim().slice(0, 30), m.id).run()
  }
  await startSession(c, m.id)
  return c.json({ role: m.role, needs_credentials: !m.password_hash, login_id: m.login_id ?? null }) // IDとパスワードは、コード(メンバー)に1組だけ紐づく
})

app.post('/api/login', async c => {
  const b = await c.req.json<any>(), id = normId(b.login_id)
  const g = await guard(c, 'login', 30, 600, b.turnstile); if (g) return g // IPごとの試行回数(成功を含む)
  // 失敗した回数だけを数える: 同じIP×IDは10分で5回まで、同じIDは(どのIPからでも)1時間で20回まで。成功したログインは数えない
  const kIp = `lf:${id}:${ipOf(c)}`, kId = `lfid:${id}`
  if ((await failCount(c.env.DB, kIp)) >= 5 || (await failCount(c.env.DB, kId)) >= 20) return c.json({ error: 'ログインに失敗した回数が多いため、しばらくログインできません(最長1時間)。時間をおいてお試しください' }, 429)
  const m = id ? await c.env.DB.prepare('SELECT id, role, password_hash, status FROM members WHERE login_id = ?').bind(id).first<any>() : null
  const ok = await verifyPassword(String(b.password ?? ''), m?.password_hash ?? null)
  if (!m || !ok || m.status !== 'active') { await recordFail(c.env.DB, kIp, 600); await recordFail(c.env.DB, kId, 3600); return err(c, 401, 'ログインIDまたはパスワードが正しくありません') }
  await clearFails(c.env.DB, kIp)
  // 「オーナーでログイン」「メンバーで参加」のどちらから入ったか。パスワードが合った人にだけ、入口の違いを案内する
  if (b.role && b.role !== m.role) return err(c, 403, m.role === 'owner' ? 'これはオーナーのIDです。「オーナーでログイン」から入ってください' : 'これはメンバーのIDです。「メンバーで参加」から入ってください')
  await startSession(c, m.id)
  return c.json({ ok: true })
})

app.post('/api/logout', async c => {
  const tok = ckey(c)
  if (tok) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(tok)).run()
  setCookie(c, cname(c), '', { httpOnly: true, secure: isHttps(c), sameSite: 'Lax', path: '/', maxAge: 0 })
  return c.json({ ok: true })
})

app.get('/api/me', c => {
  const m = c.get('m') as any
  return c.json({ login_id: m.login_id ?? null, has_password: !!m.password_hash, id: m.id, name: m.name, role: m.role, ledger_id: m.ledger_id, perms: { tx: can(m, 'can_tx'), category: can(m, 'can_category'), sub: can(m, 'can_sub'), budget: can(m, 'can_budget') } })
})
app.put('/api/me/credentials', async c => {
  const m = c.get('m') as any, b = await c.req.json<any>(), db = c.env.DB
  if (await rateLimited(db, `cred:${m.id}`, 10, 600)) return c.json({ error: '試行回数が多すぎます。しばらくしてからお試しください' }, 429)
  if (m.password_hash && !(await verifyPassword(String(b.current_password ?? ''), m.password_hash))) return err(c, 403, '現在のパスワードが正しくありません')
  const loginId = b.login_id !== undefined ? normId(b.login_id) : m.login_id
  if (!loginId || !validLoginId(loginId)) return err(c, 400, 'ログインIDは、英数字と . _ - の4〜32文字で入力してください')
  let ph: string | null = m.password_hash
  if (b.password) { if (!validPassword(b.password)) return err(c, 400, 'パスワードは8〜128文字で入力してください'); ph = await hashPassword(b.password) }
  if (!ph) return err(c, 400, 'パスワードを設定してください')
  try { await db.prepare('UPDATE members SET login_id = ?, password_hash = ? WHERE id = ?').bind(loginId, ph, m.id).run() }
  catch (e: any) { if (/UNIQUE/i.test(String(e?.message))) return err(c, 409, 'このログインIDはすでに使われています'); throw e }
  if (ph !== m.password_hash) await db.prepare('DELETE FROM sessions WHERE member_id = ? AND token_hash != ?').bind(m.id, await sha(ckey(c) || '')).run() // パスワード変更時は、他の端末をログアウト
  return c.json({ ok: true })
})
app.put('/api/me', async c => {
  const { name } = await c.req.json<any>()
  if (!name?.trim()) return err(c, 400, '表示名を入力してください')
  await c.env.DB.prepare('UPDATE members SET name = ? WHERE id = ?').bind(name.trim().slice(0, 30), c.get('m').id).run()
  return c.json({ ok: true })
})

// カテゴリ
app.get('/api/categories', async c =>
  c.json((await c.env.DB.prepare('SELECT * FROM categories WHERE ledger_id = ? ORDER BY type, sort_order, id').bind(c.get('m').ledger_id).all()).results))
app.post('/api/categories', async c => {
  const m = c.get('m'), b = await c.req.json<any>()
  if (!can(m, 'can_category')) return err(c, 403, '権限がありません')
  if (!['expense', 'income'].includes(b.type) || !b.name?.trim()) return err(c, 400, '入力内容を確認してください')
  const r = await c.env.DB.prepare('INSERT INTO categories(ledger_id, type, name, icon, sort_order) VALUES(?,?,?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE ledger_id = ? AND type = ?))').bind(m.ledger_id, b.type, b.name.trim(), iconOf(b.icon), m.ledger_id, b.type).run()
  return c.json({ id: r.meta.last_row_id })
})
app.put('/api/categories/:id', async c => {
  const m = c.get('m'), b = await c.req.json<any>()
  if (!can(m, 'can_category')) return err(c, 403, '権限がありません')
  await c.env.DB.prepare('UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ? AND ledger_id = ?')
    .bind(b.name?.trim() || null, iconOf(b.icon), b.sort_order ?? null, b.is_active ?? null, c.req.param('id'), m.ledger_id).run()
  return c.json({ ok: true })
})

// カテゴリの並び替え(種別ごとに、IDを並べた順で sort_order を振り直す)
app.put('/api/category-order', async c => {
  const m = c.get('m'), b = await c.req.json<any>(), db = c.env.DB
  if (!can(m, 'can_category')) return err(c, 403, '権限がありません')
  const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number) : []
  if (!['expense', 'income'].includes(b.type) || !ids.length || ids.length > 200 || ids.some(n => !Number.isInteger(n)) || new Set(ids).size !== ids.length) return err(c, 400, '入力内容を確認してください')
  const own = new Set(((await db.prepare('SELECT id FROM categories WHERE ledger_id = ? AND type = ?').bind(m.ledger_id, b.type).all()).results as any[]).map(r => r.id))
  if (ids.some(i => !own.has(i))) return err(c, 400, 'カテゴリが正しくありません')
  await db.batch(ids.map((id, i) => db.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND ledger_id = ?').bind(i, id, m.ledger_id)))
  return c.json({ ok: true })
})

// 明細
app.get('/api/transactions', async c => {
  const m = c.get('m'), q = c.req.query()
  let sql = `SELECT t.*, CASE WHEN mm.status = 'revoked' THEN NULL ELSE mm.name END creator, (SELECT group_concat(id) FROM receipts r WHERE r.transaction_id = t.id) receipt_ids FROM transactions t LEFT JOIN members mm ON mm.id = t.created_by WHERE t.ledger_id = ? AND t.deleted_at IS NULL`
  const a: any[] = [m.ledger_id]
  if (q.type) { sql += ' AND t.type = ?'; a.push(q.type) }
  if (q.year) { sql += ' AND substr(t.date,1,4) = ?'; a.push(q.year) }
  if (q.month) { sql += ' AND substr(t.date,6,2) = ?'; a.push(String(+q.month).padStart(2, '0')) }
  if (q.category_id) { sql += ' AND t.category_id = ?'; a.push(+q.category_id) }
  if (q.q) { sql += ' AND t.memo LIKE ?'; a.push(`%${q.q}%`) }
  sql += ' ORDER BY t.date DESC, t.created_at DESC LIMIT 500'
  return c.json((await c.env.DB.prepare(sql).bind(...a).all()).results)
})

app.put('/api/transactions/:id', async c => {
  const m = c.get('m'), id = c.req.param('id'), b = await c.req.json<any>(), db = c.env.DB
  if (!UUID.test(id)) return err(c, 400, 'IDが正しくありません')
  if (!can(m, 'can_tx')) return err(c, 403, '権限がありません')
  if (!['expense', 'income'].includes(b.type) || !DATE.test(b.date) || !Number.isInteger(b.amount) || b.amount < 0) return err(c, 400, '入力内容を確認してください')
  const catQ = 'SELECT id FROM categories WHERE id = ? AND ledger_id = ? AND type = ?'
  let cid = b.category_id
  let cat = await db.prepare(catQ).bind(cid, m.ledger_id, b.type).first()
  if (!cat) { // 引き継ぎ統合前のカテゴリIDで送られた入力は、対応表で付け替える
    const mp = await db.prepare('SELECT old_category_id FROM merge_category_map WHERE new_category_id = ? AND old_ledger_id = ? AND expires_at > ?').bind(cid, m.ledger_id, now()).first<any>()
    if (mp) { cid = mp.old_category_id; cat = await db.prepare(catQ).bind(cid, m.ledger_id, b.type).first() }
  }
  if (!cat) return err(c, 400, 'カテゴリが正しくありません')
  const memo = b.memo ? String(b.memo).slice(0, 200) : null, t = now()
  const ex = await db.prepare('SELECT ledger_id, created_by, deleted_at FROM transactions WHERE id = ?').bind(id).first<any>()
  if (ex) {
    if (ex.deleted_at) return err(c, 409, '削除済みの明細です')
    if (ex.ledger_id !== m.ledger_id || (m.role !== 'owner' && ex.created_by !== m.id)) return err(c, 403, '他のメンバーの明細は編集できません')
    await db.prepare('UPDATE transactions SET type=?, date=?, category_id=?, amount=?, memo=?, updated_at=? WHERE id=?').bind(b.type, b.date, cid, b.amount, memo, t, id).run()
  } else {
    await db.prepare('INSERT INTO transactions(id, ledger_id, type, date, category_id, amount, memo, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id, m.ledger_id, b.type, b.date, cid, b.amount, memo, m.id, t, t).run()
  }
  if (b.type === 'expense') bg(c, checkBudgets(c.env, m.ledger_id)) // 予算超過の通知
  return c.json({ id, updated_at: t })
})

app.delete('/api/transactions/:id', async c => {
  const m = c.get('m'), id = c.req.param('id')
  if (!can(m, 'can_tx')) return err(c, 403, '権限がありません')
  const ex = await c.env.DB.prepare('SELECT ledger_id, created_by FROM transactions WHERE id = ?').bind(id).first<any>()
  if (!ex || ex.ledger_id !== m.ledger_id) return err(c, 404, '明細が見つかりません')
  if (m.role !== 'owner' && ex.created_by !== m.id) return err(c, 403, '他のメンバーの明細は削除できません')
  const t = now()
  await c.env.DB.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(t, t, id).run()
  const rs = (await c.env.DB.prepare('SELECT r2_key, size FROM receipts WHERE transaction_id = ?').bind(id).all()).results as any[]
  if (rs.length) { // 明細を削除したら紐づく画像も削除
    await Promise.all(rs.map(r => c.env.RECEIPTS.delete(r.r2_key)))
    await c.env.DB.batch([c.env.DB.prepare('DELETE FROM receipts WHERE transaction_id = ?').bind(id), c.env.DB.prepare('UPDATE ledgers SET receipt_bytes = MAX(0, receipt_bytes - ?) WHERE id = ?').bind(rs.reduce((a, r) => a + r.size, 0), m.ledger_id)])
  }
  return c.json({ ok: true })
})

// サブスク
async function subBody(c: Ctx) {
  const m = c.get('m'), b = await c.req.json<any>()
  if (!can(m, 'can_sub')) return { e: err(c, 403, '権限がありません') }
  if (!b.name?.trim() || !Number.isInteger(b.amount) || b.amount < 0 || !DATE.test(b.start_date) || (b.end_date && !DATE.test(b.end_date))) return { e: err(c, 400, '入力内容を確認してください') }
  const cat = await c.env.DB.prepare(`SELECT id FROM categories WHERE id = ? AND ledger_id = ? AND type = 'expense'`).bind(b.category_id, m.ledger_id).first()
  if (!cat) return { e: err(c, 400, 'カテゴリが正しくありません') }
  return { m, b }
}
app.get('/api/subscriptions', async c =>
  c.json((await c.env.DB.prepare('SELECT * FROM subscriptions WHERE ledger_id = ? ORDER BY name').bind(c.get('m').ledger_id).all()).results))
app.post('/api/subscriptions', async c => {
  const r = await subBody(c); if (r.e) return r.e
  const { m, b } = r as any
  const x = await c.env.DB.prepare('INSERT INTO subscriptions(ledger_id, name, category_id, amount, start_date, end_date, memo) VALUES(?,?,?,?,?,?,?)').bind(m.ledger_id, b.name.trim(), b.category_id, b.amount, b.start_date, b.end_date || null, b.memo || null).run()
  return c.json({ id: x.meta.last_row_id })
})
app.put('/api/subscriptions/:id', async c => {
  const r = await subBody(c); if (r.e) return r.e
  const { m, b } = r as any
  await c.env.DB.prepare('UPDATE subscriptions SET name=?, category_id=?, amount=?, start_date=?, end_date=?, memo=? WHERE id=? AND ledger_id=?').bind(b.name.trim(), b.category_id, b.amount, b.start_date, b.end_date || null, b.memo || null, c.req.param('id'), m.ledger_id).run()
  return c.json({ ok: true })
})
app.delete('/api/subscriptions/:id', async c => {
  const m = c.get('m')
  if (!can(m, 'can_sub')) return err(c, 403, '権限がありません')
  await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND ledger_id = ?').bind(c.req.param('id'), m.ledger_id).run()
  return c.json({ ok: true })
})

// 予算 (category_id=null: 全体 / month=null: 毎月の基本額)
app.get('/api/budgets', async c =>
  c.json((await c.env.DB.prepare('SELECT category_id, month, amount FROM budgets WHERE ledger_id = ?').bind(c.get('m').ledger_id).all()).results))
app.put('/api/budgets', async c => {
  const m = c.get('m'), { items } = await c.req.json<any>(), db = c.env.DB
  if (!can(m, 'can_budget')) return err(c, 403, '権限がありません')
  if (!Array.isArray(items) || items.length > 500) return err(c, 400, '入力内容を確認してください')
  const ids = new Set(((await db.prepare(`SELECT id FROM categories WHERE ledger_id = ? AND type = 'expense'`).bind(m.ledger_id).all()).results as any[]).map(r => r.id))
  for (const i of items)
    if (!Number.isInteger(i.amount) || i.amount < 0 || (i.month && !/^\d{4}-\d{2}$/.test(i.month)) || (i.category_id && !ids.has(i.category_id))) return err(c, 400, '入力内容を確認してください')
  await db.batch([
    db.prepare('DELETE FROM budgets WHERE ledger_id = ?').bind(m.ledger_id),
    ...items.map((i: any) => db.prepare('INSERT INTO budgets(ledger_id, category_id, month, amount) VALUES(?,?,?,?)').bind(m.ledger_id, i.category_id || null, i.month || null, i.amount)),
  ])
  return c.json({ ok: true })
})

// 集計: months[ym] = { expense:{cid:額}(サブスク込み), income:{cid:額}, subs:{cid:額} }, budget[ym] = {cid:額 (0=全体)}
async function summary(c: Ctx, year: string, only?: string) {
  const lid = c.get('m').ledger_id, db = c.env.DB
  const rows = (await db.prepare(`SELECT type, category_id cid, substr(date,1,7) ym, SUM(amount) a FROM transactions WHERE ledger_id = ? AND deleted_at IS NULL AND substr(date,1,4) = ? GROUP BY 1,2,3`).bind(lid, year).all()).results as any[]
  const subs = (await db.prepare('SELECT * FROM subscriptions WHERE ledger_id = ?').bind(lid).all()).results as any[]
  const bud = (await db.prepare('SELECT category_id, month, amount FROM budgets WHERE ledger_id = ?').bind(lid).all()).results as any[]
  const yms = only ? [`${year}-${only}`] : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const months: any = {}, budget: any = {}
  const base: any = {}
  bud.filter(b => !b.month).forEach(b => (base[b.category_id ?? 0] = b.amount))
  for (const ym of yms) {
    months[ym] = { expense: {}, income: {}, subs: {} }
    budget[ym] = { ...base }
    bud.filter(b => b.month === ym).forEach(b => (budget[ym][b.category_id ?? 0] = b.amount))
  }
  rows.forEach(r => { if (months[r.ym]) months[r.ym][r.type][r.cid] = (months[r.ym][r.type][r.cid] || 0) + r.a })
  for (const ym of yms)
    for (const s of subs)
      if (s.start_date <= `${ym}-31` && (!s.end_date || s.end_date >= `${ym}-01`)) {
        const mm = months[ym]
        mm.subs[s.category_id] = (mm.subs[s.category_id] || 0) + s.amount
        mm.expense[s.category_id] = (mm.expense[s.category_id] || 0) + s.amount
      }
  return { year: +year, months, budget }
}
app.get('/api/summary/year', async c => {
  const y = c.req.query('year') || ''
  return /^\d{4}$/.test(y) ? c.json(await summary(c, y)) : err(c, 400, '年が正しくありません')
})
app.get('/api/summary/month', async c => {
  const y = c.req.query('year') || '', mo = String(+(c.req.query('month') || 0)).padStart(2, '0')
  return /^\d{4}$/.test(y) && +mo >= 1 && +mo <= 12 ? c.json(await summary(c, y, mo)) : err(c, 400, '年月が正しくありません')
})

// ---- 手順6: メンバー管理・端末 ----
const ownerOnly = (c: Ctx) => (c.get('m').role === 'owner' ? null : err(c, 403, 'オーナーのみ実行できます'))
const PERM_KEYS = ['can_tx', 'can_category', 'can_sub', 'can_budget'] as const

app.get('/api/members', async c => {
  const e = ownerOnly(c); if (e) return e
  return c.json((await c.env.DB.prepare(`SELECT id, name, note, role, status, can_tx, can_category, can_sub, can_budget, created_at FROM members WHERE ledger_id = ? AND status != 'revoked' ORDER BY role DESC, created_at`).bind(c.get('m').ledger_id).all()).results)
})
app.post('/api/members/invite', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), db = c.env.DB
  const n = await db.prepare(`SELECT COUNT(*) n FROM members WHERE ledger_id = ? AND status != 'revoked'`).bind(m.ledger_id).first<any>()
  if (n.n >= 10) return err(c, 400, '人数の上限(オーナー含め10人)に達しています')
  const b = await c.req.json<any>().catch(() => ({})), p = (k: string) => (b[k] === undefined ? 1 : b[k] ? 1 : 0) // 権限の初期値はすべてON
  const code = 'U-' + crypto.randomUUID(), id = crypto.randomUUID()
  await db.prepare(`INSERT INTO members(id, ledger_id, role, code_hash, status, created_at, note, can_tx, can_category, can_sub, can_budget) VALUES(?,?, 'user', ?, 'pending', ?, ?, ?,?,?,?)`)
    .bind(id, m.ledger_id, await sha(code), now(), clip(b.note, 50), p('can_tx'), p('can_category'), p('can_sub'), p('can_budget')).run()
  return c.json({ id, code })
})
app.put('/api/members/:id', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), b = await c.req.json<any>(), db = c.env.DB
  const t = await db.prepare(`SELECT id FROM members WHERE id = ? AND ledger_id = ? AND role = 'user' AND status != 'revoked'`).bind(c.req.param('id'), m.ledger_id).first()
  if (!t) return err(c, 404, 'メンバーが見つかりません')
  const v = (k: string) => (b[k] === undefined ? null : b[k] ? 1 : 0)
  if (b.note !== undefined) await db.prepare('UPDATE members SET note = ? WHERE id = ?').bind(clip(b.note, 50), t.id).run()
  await db.prepare('UPDATE members SET can_tx = COALESCE(?, can_tx), can_category = COALESCE(?, can_category), can_sub = COALESCE(?, can_sub), can_budget = COALESCE(?, can_budget) WHERE id = ?')
    .bind(v('can_tx'), v('can_category'), v('can_sub'), v('can_budget'), t.id).run()
  let code: string | undefined
  if (b.reissue) {
    code = 'U-' + crypto.randomUUID()
    await db.prepare('UPDATE members SET code_hash = ? WHERE id = ?').bind(await sha(code), t.id).run()
  }
  return c.json({ ok: true, code })
})
app.delete('/api/members/:id', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), db = c.env.DB
  const t = await db.prepare(`SELECT id FROM members WHERE id = ? AND ledger_id = ? AND role = 'user'`).bind(c.req.param('id'), m.ledger_id).first<any>()
  if (!t) return err(c, 404, 'メンバーが見つかりません')
  // 明細は残す(入力者は「削除されたユーザー」と表示)ため、行は消さず無効化する
  await db.batch([db.prepare('DELETE FROM sessions WHERE member_id = ?').bind(t.id), db.prepare('DELETE FROM device_links WHERE member_id = ?').bind(t.id), db.prepare('DELETE FROM push_subscriptions WHERE member_id = ?').bind(t.id), db.prepare('DELETE FROM announcement_reads WHERE member_id = ?').bind(t.id),
    db.prepare('DELETE FROM inquiry_messages WHERE inquiry_id IN (SELECT id FROM inquiries WHERE member_id = ?)').bind(t.id), db.prepare('DELETE FROM inquiries WHERE member_id = ?').bind(t.id),
    db.prepare(`UPDATE members SET status = 'revoked', login_id = NULL, password_hash = NULL WHERE id = ?`).bind(t.id)])
  return c.json({ ok: true })
})
app.post('/api/me/owner-code', async c => {
  const e = ownerOnly(c); if (e) return e
  const code = 'O-' + crypto.randomUUID()
  await c.env.DB.prepare('UPDATE members SET code_hash = ? WHERE id = ?').bind(await sha(code), c.get('m').id).run()
  return c.json({ code })
})
app.get('/api/me/sessions', async c => {
  const cur = await sha(ckey(c) || '')
  const rows = (await c.env.DB.prepare('SELECT id, device_label, created_at, last_used_at, token_hash FROM sessions WHERE member_id = ? ORDER BY last_used_at DESC').bind(c.get('m').id).all()).results as any[]
  return c.json(rows.map(({ token_hash, ...r }) => ({ ...r, current: token_hash === cur })))
})
app.delete('/api/me/sessions/:id', async c => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND member_id = ?').bind(c.req.param('id'), c.get('m').id).run()
  return c.json({ ok: true })
})

// ---- 手順7: CSVエクスポート(オーナーのみ・画像は含めない) ----
app.get('/api/export/csv', async c => {
  const e = ownerOnly(c); if (e) return e
  const y = c.req.query('year') || ''
  if (!/^\d{4}$/.test(y)) return err(c, 400, '年が正しくありません')
  const rows = (await c.env.DB.prepare(`SELECT t.id, t.created_by, t.date, t.type, k.name cat, t.amount, t.memo, CASE WHEN mm.status = 'revoked' THEN '削除されたユーザー' ELSE mm.name END creator
    FROM transactions t JOIN categories k ON k.id = t.category_id LEFT JOIN members mm ON mm.id = t.created_by
    WHERE t.ledger_id = ? AND t.deleted_at IS NULL AND substr(t.date,1,4) = ? ORDER BY t.date`).bind(c.get('m').ledger_id, y).all()).results as any[]
  const esc = (v: any) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }
  const body = '\uFEFF日付,種別,カテゴリ,金額,備考,入力者,入力者ID,明細ID\r\n' + rows.map(r => [r.date, r.type === 'expense' ? '支出' : '収入', r.cat, r.amount, r.memo, r.creator, r.created_by, r.id].map(esc).join(',')).join('\r\n')
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="kakeibo-${y}.csv"` } })
})

// ---- 手順8: レシート画像(R2・非公開。Workerが認証して中継) ----
const isImg = (b: Uint8Array, t: string) =>
  t === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  : t === 'image/webp' ? String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' : false
async function ownTx(c: Ctx, id: string) {
  const m = c.get('m')
  const t = await c.env.DB.prepare('SELECT ledger_id, created_by FROM transactions WHERE id = ? AND deleted_at IS NULL').bind(id).first<any>()
  if (!t || t.ledger_id !== m.ledger_id) return { e: err(c, 404, '明細が見つかりません') }
  if (!can(m, 'can_tx')) return { e: err(c, 403, '権限がありません') }
  if (m.role !== 'owner' && t.created_by !== m.id) return { e: err(c, 403, '他のメンバーの明細には添付できません') }
  return { ok: true }
}
app.post('/api/transactions/:id/receipts', async c => {
  const id = c.req.param('id'), m = c.get('m'), db = c.env.DB
  const o = await ownTx(c, id); if ('e' in o) return o.e
  const b = await c.req.json<any>()
  if (!['image/jpeg', 'image/webp'].includes(b.content_type) || typeof b.data !== 'string') return err(c, 400, '画像の形式が正しくありません')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(b.data), ch => ch.charCodeAt(0)) } catch { return err(c, 400, '画像を読み取れません') }
  if (bytes.length > RCPT_BYTES) return err(c, 400, '画像は1枚1MBまでです')
  if (!isImg(bytes, b.content_type)) return err(c, 400, '画像の形式が正しくありません')
  const n = await db.prepare('SELECT COUNT(*) n FROM receipts WHERE transaction_id = ?').bind(id).first<any>()
  if (n.n >= RCPT_MAX) return err(c, 400, '画像は1明細5枚までです')
  const led = await db.prepare('SELECT receipt_bytes FROM ledgers WHERE id = ?').bind(m.ledger_id).first<any>()
  if (led.receipt_bytes + bytes.length > LEDGER_QUOTA) return err(c, 400, '画像の保存容量の上限に達しました。古い画像を削除してください')
  const rid = crypto.randomUUID(), key = `${m.ledger_id}/${crypto.randomUUID()}`
  await c.env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: b.content_type } })
  await db.batch([
    db.prepare('INSERT INTO receipts(id, ledger_id, transaction_id, r2_key, content_type, size, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)').bind(rid, m.ledger_id, id, key, b.content_type, bytes.length, m.id, now()),
    db.prepare('UPDATE ledgers SET receipt_bytes = receipt_bytes + ? WHERE id = ?').bind(bytes.length, m.ledger_id),
    db.prepare('UPDATE transactions SET updated_at = ? WHERE id = ?').bind(now(), id), // 他端末の同期で画像の追加が分かるように
  ])
  return c.json({ id: rid })
})
app.get('/api/receipts/usage', async c => {
  const l = await c.env.DB.prepare('SELECT receipt_bytes FROM ledgers WHERE id = ?').bind(c.get('m').ledger_id).first<any>()
  return c.json({ used: l.receipt_bytes, limit: LEDGER_QUOTA })
})
app.get('/api/receipts/:id', async c => {
  const r = await c.env.DB.prepare('SELECT r2_key, content_type FROM receipts WHERE id = ? AND ledger_id = ?').bind(c.req.param('id'), c.get('m').ledger_id).first<any>()
  const o = r && (await c.env.RECEIPTS.get(r.r2_key))
  if (!r || !o) return err(c, 404, '画像が見つかりません')
  return new Response(o.body, { headers: { 'Content-Type': r.content_type, 'Cache-Control': 'private, max-age=86400' } })
})
app.delete('/api/receipts/:id', async c => {
  const m = c.get('m'), db = c.env.DB
  const r = await db.prepare('SELECT r2_key, size, created_by, transaction_id FROM receipts WHERE id = ? AND ledger_id = ?').bind(c.req.param('id'), m.ledger_id).first<any>()
  if (!r) return err(c, 404, '画像が見つかりません')
  if (!can(m, 'can_tx') || (m.role !== 'owner' && r.created_by !== m.id)) return err(c, 403, '権限がありません')
  await c.env.RECEIPTS.delete(r.r2_key)
  await db.batch([db.prepare('DELETE FROM receipts WHERE id = ?').bind(c.req.param('id')), db.prepare('UPDATE ledgers SET receipt_bytes = MAX(0, receipt_bytes - ?) WHERE id = ?').bind(r.size, m.ledger_id), db.prepare('UPDATE transactions SET updated_at = ? WHERE id = ?').bind(now(), r.transaction_id)])
  return c.json({ ok: true })
})

// ---- 手順9: オフライン同期 ----
app.get('/api/sync', async c => {
  const m = c.get('m'), since = c.req.query('since') || ''
  const rows = (await c.env.DB.prepare(`SELECT t.id, t.type, t.date, t.category_id, t.amount, t.memo, t.created_by, t.created_at, t.updated_at, t.deleted_at,
      (SELECT group_concat(id) FROM receipts r WHERE r.transaction_id = t.id) receipt_ids
    FROM transactions t WHERE t.ledger_id = ? AND t.updated_at >= ? ORDER BY t.updated_at LIMIT 2000`).bind(m.ledger_id, since).all()).results
  const people = (await c.env.DB.prepare(`SELECT id, CASE WHEN status = 'revoked' THEN NULL ELSE name END name FROM members WHERE ledger_id = ?`).bind(m.ledger_id).all()).results
  return c.json({ now: now(), ledger_id: m.ledger_id, transactions: rows, people, more: rows.length === 2000 })
})
// 送信待ちキューの一括送信。各操作は通常のAPI(権限・所有者の確認つき)をそのまま通す。IDはUUIDなので二重送信しても重複しない
app.post('/api/sync/push', async c => {
  const { ops } = await c.req.json<any>()
  if (!Array.isArray(ops) || ops.length > 200) return err(c, 400, '入力内容を確認してください')
  const origin = new URL(c.req.url).origin, results: any[] = []
  for (const o of ops) {
    if (!UUID.test(o.id) || !['upsert', 'delete'].includes(o.kind)) { results.push({ opId: o.opId, ok: false, status: 400, error: '操作が正しくありません' }); continue }
    const headers = new Headers(c.req.raw.headers)
    headers.set('Content-Type', 'application/json'); headers.delete('Content-Length')
    const res = await app.fetch(new Request(`${origin}/api/transactions/${o.id}`, { method: o.kind === 'upsert' ? 'PUT' : 'DELETE', headers, body: o.kind === 'upsert' ? JSON.stringify(o.data) : undefined }), c.env, (() => { try { return c.executionCtx } catch { return undefined } })())
    if (res.ok) results.push({ opId: o.opId, ok: true })
    else results.push({ opId: o.opId, ok: false, status: res.status, error: ((await res.json().catch(() => ({}))) as any).error || 'エラーが発生しました' })
  }
  return c.json({ results })
})

// ---- 手順10: 端末追加コード(D-, 10分・1回限り) / 引き継ぎトークン(H-, 24時間・1回限り) ----
app.post('/api/me/device-link', async c => {
  const m = c.get('m'), db = c.env.DB, b = await c.req.json<any>().catch(() => ({}))
  if (!['device', 'handoff'].includes(b.purpose)) return err(c, 400, '種類が正しくありません')
  await db.prepare('DELETE FROM device_links WHERE member_id = ? AND (expires_at < ? OR used_at IS NOT NULL)').bind(m.id, now()).run()
  const n = await db.prepare('SELECT COUNT(*) n FROM device_links WHERE member_id = ?').bind(m.id).first<any>()
  if (n.n >= 10) return err(c, 400, '発行済みのコードが多すぎます。しばらくしてからお試しください')
  const code = (b.purpose === 'device' ? 'D-' : 'H-') + crypto.randomUUID()
  const exp = new Date(Date.now() + (b.purpose === 'device' ? 10 * 60e3 : 24 * 3600e3)).toISOString()
  await db.prepare('INSERT INTO device_links(code_hash, member_id, purpose, expires_at) VALUES(?,?,?,?)').bind(await sha(code), m.id, b.purpose, exp).run()
  return c.json({ code, expires_at: exp })
})

// ---- 手順11: 問い合わせ(利用者) ----
const KINDS = ['question', 'request', 'bug']
const bodyOf = (b: any) => { const t = String(b?.body ?? '').trim(); return t && t.length <= 2000 ? t : null }
const overLimit = async (c: Ctx) => ((await c.env.DB.prepare(`SELECT COUNT(*) n FROM inquiry_messages im JOIN inquiries i ON i.id = im.inquiry_id WHERE i.member_id = ? AND im.sender = 'member' AND im.created_at > ?`).bind(c.get('m').id, new Date(Date.now() - DAY).toISOString()).first<any>())!.n >= 10)
const ownInquiry = (c: Ctx) => c.env.DB.prepare('SELECT * FROM inquiries WHERE id = ? AND member_id = ?').bind(c.req.param('id'), c.get('m').id).first<any>()

app.get('/api/inquiries', async c => c.json((await c.env.DB.prepare(`SELECT i.id, i.kind, i.status, i.created_at,
    (SELECT body FROM inquiry_messages WHERE inquiry_id = i.id ORDER BY id DESC LIMIT 1) last_body,
    (SELECT MAX(created_at) FROM inquiry_messages WHERE inquiry_id = i.id) last_at,
    (SELECT COUNT(*) FROM inquiry_messages WHERE inquiry_id = i.id AND sender = 'admin' AND read_at IS NULL) unread
  FROM inquiries i WHERE i.member_id = ? ORDER BY last_at DESC`).bind(c.get('m').id).all()).results))
app.post('/api/inquiries', async c => {
  const b = await c.req.json<any>(), text = bodyOf(b)
  const g = await guard(c, 'inq', 60, 3600, b.turnstile); if (g) return g
  if (!KINDS.includes(b.kind) || !text) return err(c, 400, '種別と本文(2000文字まで)を入力してください')
  if (await overLimit(c)) return err(c, 400, '1日の送信上限(10件)に達しました。明日またお試しください')
  const t = now(), r = await c.env.DB.prepare('INSERT INTO inquiries(member_id, kind, created_at) VALUES(?,?,?)').bind(c.get('m').id, b.kind, t).run()
  await c.env.DB.prepare(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'member', ?, ?)`).bind(r.meta.last_row_id, text, t).run()
  return c.json({ id: r.meta.last_row_id })
})
app.get('/api/inquiries/:id', async c => {
  const i = await ownInquiry(c)
  if (!i) return err(c, 404, '問い合わせが見つかりません') // 他のメンバーのものは見えない
  await c.env.DB.prepare(`UPDATE inquiry_messages SET read_at = ? WHERE inquiry_id = ? AND sender = 'admin' AND read_at IS NULL`).bind(now(), i.id).run()
  return c.json({ inquiry: i, messages: (await c.env.DB.prepare('SELECT id, sender, body, created_at FROM inquiry_messages WHERE inquiry_id = ? ORDER BY id').bind(i.id).all()).results })
})
app.post('/api/inquiries/:id/messages', async c => {
  const i = await ownInquiry(c), text = bodyOf(await c.req.json<any>())
  if (!i) return err(c, 404, '問い合わせが見つかりません')
  if (!text) return err(c, 400, '本文(2000文字まで)を入力してください')
  if (await overLimit(c)) return err(c, 400, '1日の送信上限(10件)に達しました。明日またお試しください')
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'member', ?, ?)`).bind(i.id, text, now()),
    c.env.DB.prepare(`UPDATE inquiries SET status = 'open' WHERE id = ?`).bind(i.id),
  ])
  return c.json({ ok: true })
})
app.get('/api/unread-count', async c => {
  const r = await c.env.DB.prepare(`SELECT COUNT(*) n FROM inquiry_messages im JOIN inquiries i ON i.id = im.inquiry_id WHERE i.member_id = ? AND im.sender = 'admin' AND im.read_at IS NULL`).bind(c.get('m').id).first<any>()
  const m = c.get('m') as any
  const a = await c.env.DB.prepare(`SELECT COUNT(*) n FROM announcements a WHERE a.publish_at <= ? AND a.publish_at >= ? AND (a.target = 'all' OR a.target = ?) AND NOT EXISTS (SELECT 1 FROM announcement_reads x WHERE x.announcement_id = a.id AND x.member_id = ?)`).bind(now(), m.created_at, m.role, m.id).first<any>()
  return c.json({ replies: r!.n, announcements: a!.n, total: r!.n + a!.n })
})

// ---- 手順11: 管理者API(Cloudflare Access で保護。Workerでもトークンを検証) ----
// 管理者の認証は次のどれか: ① ローカル開発のバイパス ② Cloudflare Access ③ 管理者ログイン(パスワード+確認コード)
const adminCookie = (c: Ctx) => (isHttps(c) ? '__Host-admin' : 'admin')
async function adminWho(c: Ctx): Promise<string | null> {
  if (['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname) && c.env.ADMIN_DEV_BYPASS === 'true') return 'dev'
  const jwt = c.req.header('Cf-Access-Jwt-Assertion')
  if (jwt) { const who = await verifyAccess(c.env, jwt); if (who) return who }
  const tok = getCookie(c, '__Host-admin') || getCookie(c, 'admin')
  return tok && (await verifyAdminToken(c.env, tok)) ? 'admin' : null
}
const adminPwReady = (env: Env) => !!(env.ADMIN_PASSWORD_HASH && env.ADMIN_SESSION_SECRET)
app.get('/api/admin-auth/status', async c => c.json({ authed: !!(await adminWho(c)), password: adminPwReady(c.env), totp: !!c.env.ADMIN_TOTP_SECRET, access: !!(c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN), session: !!(getCookie(c, '__Host-admin') || getCookie(c, 'admin')) }))
app.post('/api/admin-auth/login', async c => {
  const b = await c.req.json<any>(), db = c.env.DB, ip = ipOf(c)
  if (!adminPwReady(c.env)) return err(c, 403, '管理者のパスワードが設定されていません(npm run admin:setup)')
  if ((await failCount(db, `adm:${ip}`)) >= 5 || (await failCount(db, 'adm:all')) >= 20) return c.json({ error: 'ログインに失敗した回数が多いため、しばらくログインできません。時間をおいてお試しください' }, 429)
  if (!(await turnstileOk(c.env, b.turnstile, ip))) return err(c, 403, '確認に失敗しました。もう一度お試しください')
  const pwOk = await verifyPassword(String(b.password ?? ''), c.env.ADMIN_PASSWORD_HASH!)
  const otpOk = pwOk && (!c.env.ADMIN_TOTP_SECRET || (await verifyTotp(c.env, String(b.code ?? '').trim()))) // パスワードが合ったときだけ確認コードを消費
  if (!pwOk || !otpOk) { await recordFail(db, `adm:${ip}`, 600); await recordFail(db, 'adm:all', 3600); return err(c, 401, 'パスワードまたは確認コードが正しくありません') }
  await clearFails(db, `adm:${ip}`)
  setCookie(c, adminCookie(c), await signAdminToken(c.env, 8 * 3600), { httpOnly: true, secure: isHttps(c), sameSite: 'Strict', path: '/', maxAge: 8 * 3600 })
  await db.prepare(`INSERT INTO audit_log(actor, action, target, created_at) VALUES('admin', 'admin.login', ?, ?)`).bind(ip, now()).run()
  return c.json({ ok: true })
})
app.post('/api/admin-auth/logout', c => {
  setCookie(c, adminCookie(c), '', { httpOnly: true, secure: isHttps(c), sameSite: 'Strict', path: '/', maxAge: 0 })
  return c.json({ ok: true })
})
app.use('/api/admin/*', async (c, next) => {
  const who = await adminWho(c)
  if (!who) return err(c, 403, '管理者として認証されていません')
  c.set('admin', who)
  await next()
})
app.get('/api/admin/inquiries', async c => {
  const st = c.req.query('status')
  return c.json((await c.env.DB.prepare(`SELECT i.id, i.kind, i.status, i.created_at, m.name member_name, m.role member_role,
      (SELECT body FROM inquiry_messages WHERE inquiry_id = i.id ORDER BY id DESC LIMIT 1) last_body,
      (SELECT sender FROM inquiry_messages WHERE inquiry_id = i.id ORDER BY id DESC LIMIT 1) last_sender,
      (SELECT MAX(created_at) FROM inquiry_messages WHERE inquiry_id = i.id) last_at
    FROM inquiries i JOIN members m ON m.id = i.member_id ${st ? 'WHERE i.status = ?' : ''} ORDER BY last_at DESC LIMIT 200`).bind(...(st ? [st] : [])).all()).results)
})
app.get('/api/admin/inquiries/:id', async c => {
  const i = await c.env.DB.prepare('SELECT i.*, m.name member_name, m.role member_role, m.created_at member_since FROM inquiries i JOIN members m ON m.id = i.member_id WHERE i.id = ?').bind(c.req.param('id')).first<any>()
  if (!i) return err(c, 404, '問い合わせが見つかりません')
  return c.json({ inquiry: i, messages: (await c.env.DB.prepare('SELECT id, sender, body, created_at FROM inquiry_messages WHERE inquiry_id = ? ORDER BY id').bind(i.id).all()).results })
})
app.post('/api/admin/inquiries/:id/reply', async c => {
  const text = bodyOf(await c.req.json<any>()), id = c.req.param('id')
  if (!text) return err(c, 400, '本文(2000文字まで)を入力してください')
  const inq = await c.env.DB.prepare('SELECT id, member_id FROM inquiries WHERE id = ?').bind(id).first<any>()
  if (!inq) return err(c, 404, '問い合わせが見つかりません')
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'admin', ?, ?)`).bind(id, text, now()),
    c.env.DB.prepare(`UPDATE inquiries SET status = 'replied' WHERE id = ?`).bind(id),
    c.env.DB.prepare(`INSERT INTO audit_log(actor, action, target, created_at) VALUES('admin', 'inquiry.reply', ?, ?)`).bind(id, now()),
  ])
  bg(c, notifyReply(c.env, inq.member_id, id))
  return c.json({ ok: true })
})
app.patch('/api/admin/inquiries/:id', async c => {
  const { status } = await c.req.json<any>()
  if (!['open', 'replied', 'closed'].includes(status)) return err(c, 400, '状態が正しくありません')
  await c.env.DB.prepare('UPDATE inquiries SET status = ? WHERE id = ?').bind(status, c.req.param('id')).run()
  return c.json({ ok: true })
})
// メンバー検索: 最終操作時間は専用カラムを持たず、明細の updated_at の最大値から求めて表示するだけ
app.get('/api/admin/members', async c => {
  const q = c.req.query('q') || '', role = c.req.query('role') || ''
  return c.json((await c.env.DB.prepare(`SELECT m.id, m.name, m.role, m.status, m.created_at,
      (SELECT MAX(t.updated_at) FROM transactions t WHERE t.created_by = m.id AND t.deleted_at IS NULL) last_op,
      (SELECT COUNT(*) FROM transactions t WHERE t.created_by = m.id AND t.deleted_at IS NULL) tx_count,
      (SELECT MAX(s.last_used_at) FROM sessions s WHERE s.member_id = m.id) last_access
    FROM members m WHERE m.status != 'revoked' AND (? = '' OR m.name LIKE ?) AND (? = '' OR m.role = ?)
    ORDER BY last_op IS NULL, last_op DESC LIMIT 200`).bind(q, `%${q}%`, role, role).all()).results)
})
app.get('/api/admin/stats', async c => c.json(await c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM ledgers) ledgers, (SELECT COUNT(*) FROM members WHERE status = 'active') members,
  (SELECT COALESCE(SUM(receipt_bytes), 0) FROM ledgers) receipt_bytes`).first()))

// ---- CSVの取り込み(オーナーのみ。dry_run で内容を確認してから実行) ----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [], s = text.replace(/^\uFEFF/, '')
  let row: string[] = [], f = '', q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = [] }
    else f += ch
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows
}
app.post('/api/import/csv', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), db = c.env.DB, b = await c.req.json<any>(), text = String(b.csv ?? '')
  if (text.length > 2_000_000) return err(c, 400, 'ファイルが大きすぎます(2MBまで)')
  const rows = parseCsv(text)
  if (rows.length < 2) return err(c, 400, 'データがありません')
  if (rows.length - 1 > 5000) return err(c, 400, '一度に取り込めるのは5000行までです')
  const head = rows[0].map(s => s.trim()), at = (n: string) => head.indexOf(n)
  const col = { date: at('日付'), type: at('種別'), cat: at('カテゴリ'), amount: at('金額'), memo: at('備考'), uid: at('入力者ID'), id: at('明細ID') }
  if (col.date < 0 || col.type < 0 || col.cat < 0 || col.amount < 0) return err(c, 400, '見出し(日付・種別・カテゴリ・金額)が見つかりません。書き出したCSVの形式にしてください')
  const cats = (await db.prepare('SELECT id, type, name FROM categories WHERE ledger_id = ?').bind(m.ledger_id).all()).results as any[]
  const members = new Set(((await db.prepare(`SELECT id FROM members WHERE ledger_id = ? AND status != 'revoked'`).bind(m.ledger_id).all()).results as any[]).map(x => x.id))
  const ids = rows.slice(1).map(r => (col.id >= 0 ? (r[col.id] || '').trim() : '')).filter(Boolean)
  const existing = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 90) { const ch = ids.slice(i, i + 90).filter(x => UUID.test(x)); if (ch.length) for (const r of (await db.prepare(`SELECT id, ledger_id FROM transactions WHERE id IN (${ch.map(() => '?').join(',')})`).bind(...ch).all()).results as any[]) existing.set(r.id, r.ledger_id) }
  const errors: { line: number; msg: string }[] = [], list: any[] = [], missing = new Map<string, { type: string; name: string }>()
  const T: Record<string, string> = { 支出: 'expense', 収入: 'income', expense: 'expense', income: 'income' }
  rows.slice(1).forEach((r, i) => {
    const line = i + 2, bad = (msg: string) => errors.push({ line, msg })
    const type = T[(r[col.type] || '').trim()], dm = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec((r[col.date] || '').trim())
    const amount = (r[col.amount] || '').replace(/[¥￥,\s]/g, ''), name = (r[col.cat] || '').trim()
    const date = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : ''
    if (!type) return bad('種別は「支出」か「収入」にしてください')
    if (!date || isNaN(+new Date(date))) return bad('日付が正しくありません(例: 2026-10-03)')
    if (!/^\d{1,10}$/.test(amount)) return bad('金額は0以上の整数にしてください')
    if (!name || name.length > 30) return bad('カテゴリ名を入力してください(30文字まで)')
    const id = col.id >= 0 ? (r[col.id] || '').trim() : ''
    if (id && !UUID.test(id)) return bad('明細IDの形式が正しくありません')
    const memo = (r[col.memo] || '').replace(/^'(?=[=+\-@\t\r])/, '').slice(0, 200) || null // 書き出し時の式の無効化(先頭の ')を戻す
    const uid = col.uid >= 0 ? (r[col.uid] || '').trim() : ''
    if (!cats.some(x => x.type === type && x.name === name)) missing.set(type + '|' + name, { type, name })
    const mine = !!id && existing.get(id) === m.ledger_id // 別の家計簿のIDは使わず、新しい明細として取り込む(他の家計簿を書き換えない)
    list.push({ id: mine ? id : crypto.randomUUID(), isUpdate: mine, type, date, name, amount: +amount, memo, by: members.has(uid) ? uid : m.id })
  })
  const summary = { imported: list.filter(x => !x.isUpdate).length, updated: list.filter(x => x.isUpdate).length, new_categories: [...missing.values()].map(x => x.name), errors: errors.slice(0, 50), error_count: errors.length }
  if (b.dry_run) return c.json({ dry_run: true, ...summary })
  if (errors.length) return c.json({ error: `${errors.length}件の行に問題があります。修正してからもう一度お試しください`, ...summary }, 400)
  for (const mc of missing.values()) {
    const r = await db.prepare('INSERT INTO categories(ledger_id, type, name, sort_order) VALUES(?,?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE ledger_id = ? AND type = ?))').bind(m.ledger_id, mc.type, mc.name, m.ledger_id, mc.type).run()
    cats.push({ id: r.meta.last_row_id, type: mc.type, name: mc.name })
  }
  const t = now()
  const stmts = list.map(x => db.prepare(`INSERT INTO transactions(id, ledger_id, type, date, category_id, amount, memo, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET type = excluded.type, date = excluded.date, category_id = excluded.category_id, amount = excluded.amount, memo = excluded.memo, updated_at = excluded.updated_at, deleted_at = NULL`)
    .bind(x.id, m.ledger_id, x.type, x.date, cats.find(k => k.type === x.type && k.name === x.name).id, x.amount, x.memo, x.by, t, t))
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100))
  return c.json({ ...summary, dry_run: false })
})

// ---- 手順12: お知らせ・プッシュ通知 ----
app.get('/api/config', c => c.json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '', vapidPublicKey: c.env.VAPID_PUBLIC_KEY || '' }))
app.get('/api/announcements', async c => {
  const m = c.get('m') as any
  return c.json((await c.env.DB.prepare(`SELECT a.id, a.title, a.body, a.publish_at,
      EXISTS (SELECT 1 FROM announcement_reads x WHERE x.announcement_id = a.id AND x.member_id = ?) read
    FROM announcements a WHERE a.publish_at <= ? AND a.publish_at >= ? AND (a.target = 'all' OR a.target = ?) ORDER BY a.publish_at DESC LIMIT 100`).bind(m.id, now(), m.created_at, m.role).all()).results)
})
app.post('/api/announcements/:id/read', async c => {
  await c.env.DB.prepare('INSERT OR IGNORE INTO announcement_reads(member_id, announcement_id, read_at) VALUES(?,?,?)').bind(c.get('m').id, c.req.param('id'), now()).run()
  return c.json({ ok: true })
})
const okEndpoint = (c: Ctx, u: string) => {
  try {
    const x = new URL(u), local = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname)
    return u.length <= 600 && ((local && ['localhost', '127.0.0.1'].includes(x.hostname)) || (x.protocol === 'https:' && /(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/.test(x.hostname)))
  } catch { return false }
}
app.post('/api/push/subscribe', async c => {
  const b = await c.req.json<any>()
  if (!okEndpoint(c, b.endpoint) || !b.keys?.p256dh || !b.keys?.auth) return err(c, 400, '通知の登録情報が正しくありません')
  await c.env.DB.prepare('INSERT INTO push_subscriptions(member_id, endpoint, p256dh, auth, created_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth')
    .bind(c.get('m').id, b.endpoint, b.keys.p256dh, b.keys.auth, now()).run()
  return c.json({ ok: true })
})
app.delete('/api/push/subscribe', async c => {
  const b = await c.req.json<any>()
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?').bind(String(b.endpoint || ''), c.get('m').id).run()
  return c.json({ ok: true })
})
app.get('/api/me/notifications', async c => {
  const m = c.get('m'), ep = c.req.query('endpoint') || ''
  const me = await c.env.DB.prepare('SELECT notify_budget FROM members WHERE id = ?').bind(m.id).first<any>()
  const s = ep ? await c.env.DB.prepare('SELECT notify_reply, notify_announce FROM push_subscriptions WHERE endpoint = ? AND member_id = ?').bind(ep, m.id).first<any>() : null
  return c.json({ notify_budget: !!me!.notify_budget, subscribed: !!s, notify_reply: s ? !!s.notify_reply : true, notify_announce: s ? !!s.notify_announce : true })
})
app.put('/api/me/notifications', async c => {
  const m = c.get('m'), b = await c.req.json<any>(), v = (k: string) => (b[k] === undefined ? null : b[k] ? 1 : 0)
  await c.env.DB.prepare('UPDATE members SET notify_budget = COALESCE(?, notify_budget) WHERE id = ?').bind(v('notify_budget'), m.id).run()
  if (b.endpoint) await c.env.DB.prepare('UPDATE push_subscriptions SET notify_reply = COALESCE(?, notify_reply), notify_announce = COALESCE(?, notify_announce) WHERE endpoint = ? AND member_id = ?').bind(v('notify_reply'), v('notify_announce'), b.endpoint, m.id).run()
  return c.json({ ok: true })
})
// 管理者: お知らせの管理
const annBody = (c: Ctx, b: any) => {
  const title = String(b.title || '').trim(), body = String(b.body || '').trim()
  if (!title || title.length > 100 || !body || body.length > 2000 || !['all', 'owner', 'user'].includes(b.target)) return null
  const at = b.publish_at ? new Date(b.publish_at) : new Date()
  if (isNaN(+at)) return null
  return { title, body, target: b.target, send_push: b.send_push ? 1 : 0, publish_at: at.toISOString() }
}
app.get('/api/admin/announcements', async c => c.json((await c.env.DB.prepare('SELECT * FROM announcements ORDER BY publish_at DESC LIMIT 200').all()).results))
app.post('/api/admin/announcements', async c => {
  const a = annBody(c, await c.req.json<any>())
  if (!a) return err(c, 400, '入力内容を確認してください(タイトル100文字・本文2000文字まで)')
  const r = await c.env.DB.prepare('INSERT INTO announcements(title, body, target, send_push, publish_at) VALUES(?,?,?,?,?)').bind(a.title, a.body, a.target, a.send_push, a.publish_at).run()
  if (a.send_push && a.publish_at <= now()) bg(c, pushAnnouncement(c.env, { id: r.meta.last_row_id as number, title: a.title, target: a.target })) // 予約なら Cron が配信
  return c.json({ id: r.meta.last_row_id })
})
app.put('/api/admin/announcements/:id', async c => {
  const a = annBody(c, await c.req.json<any>()), id = c.req.param('id')
  if (!a) return err(c, 400, '入力内容を確認してください')
  await c.env.DB.prepare('UPDATE announcements SET title=?, body=?, target=?, send_push=?, publish_at=? WHERE id=?').bind(a.title, a.body, a.target, a.send_push, a.publish_at, id).run()
  if (a.send_push && a.publish_at <= now()) bg(c, pushAnnouncement(c.env, { id: +id, title: a.title, target: a.target }))
  return c.json({ ok: true })
})
app.delete('/api/admin/announcements/:id', async c => {
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').bind(c.req.param('id')), c.env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(c.req.param('id'))])
  return c.json({ ok: true })
})

// ---- 手順13: 引き継ぎ申請(管理者が確認して、新しい家計簿を元の家計簿へ統合) ----
const clip = (v: any, n: number) => String(v ?? '').trim().slice(0, n)
app.post('/api/recovery', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), db = c.env.DB, b = await c.req.json<any>()
  const g = await guard(c, 'recovery', 10, 86400, b.turnstile); if (g) return g
  if (await db.prepare(`SELECT id FROM recovery_requests WHERE new_member_id = ? AND status = 'pending'`).bind(m.id).first()) return err(c, 400, 'すでに申請中です。管理者の確認をお待ちください')
  const n = await db.prepare('SELECT COUNT(*) n FROM recovery_requests WHERE new_member_id = ? AND created_at > ?').bind(m.id, new Date(Date.now() - 7 * DAY).toISOString()).first<any>()
  if (n!.n >= 3) return err(c, 400, '申請の回数が上限に達しました。しばらくしてからお試しください')
  const claim = { prev_name: clip(b.prev_name, 30), period: clip(b.period, 50), recent: clip(b.recent, 1500), other: clip(b.other, 500) }
  if (!claim.prev_name || !claim.recent) return err(c, 400, '以前の表示名と、覚えている直近の明細を入力してください')
  const t = now(), text = `【引き継ぎ申請】
以前の表示名: ${claim.prev_name}
作成時期: ${claim.period || '(未入力)'}
直近の明細:
${claim.recent}
その他: ${claim.other || '(なし)'}`
  const inq = await db.prepare(`INSERT INTO inquiries(member_id, kind, created_at) VALUES(?, 'recovery', ?)`).bind(m.id, t).run()
  await db.batch([
    db.prepare(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'member', ?, ?)`).bind(inq.meta.last_row_id, text, t),
    db.prepare('INSERT INTO recovery_requests(inquiry_id, new_member_id, claim_json, created_at) VALUES(?,?,?,?)').bind(inq.meta.last_row_id, m.id, JSON.stringify(claim), t),
  ])
  return c.json({ id: inq.meta.last_row_id })
})
app.get('/api/admin/recovery', async c => c.json((await c.env.DB.prepare(`SELECT r.id, r.status, r.created_at, r.inquiry_id, m.name new_name FROM recovery_requests r JOIN members m ON m.id = r.new_member_id ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 100`).all()).results))
app.get('/api/admin/recovery/:id', async c => {
  const r = await c.env.DB.prepare(`SELECT r.*, m.name new_name, m.created_at new_since FROM recovery_requests r JOIN members m ON m.id = r.new_member_id WHERE r.id = ?`).bind(c.req.param('id')).first<any>()
  if (!r) return err(c, 404, '申請が見つかりません')
  return c.json({ ...r, claim: JSON.parse(r.claim_json) })
})
app.get('/api/admin/recovery/:id/candidates', async c => {
  const rq = await c.env.DB.prepare('SELECT new_member_id FROM recovery_requests WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!rq) return err(c, 404, '申請が見つかりません')
  const name = c.req.query('name') || ''
  return c.json((await c.env.DB.prepare(`SELECT m.id member_id, m.name, m.created_at member_since, l.created_at ledger_created,
      (SELECT MAX(t.updated_at) FROM transactions t WHERE t.ledger_id = m.ledger_id) last_op,
      (SELECT COUNT(*) FROM members x WHERE x.ledger_id = m.ledger_id AND x.status != 'revoked') member_count
    FROM members m JOIN ledgers l ON l.id = m.ledger_id
    WHERE m.role = 'owner' AND m.status = 'active' AND m.id != ? AND (? = '' OR m.name LIKE ?) ORDER BY last_op DESC LIMIT 50`).bind(rq.new_member_id, name, `%${name}%`).all()).results)
})
// 同じ家計簿を対象にした申請は、30日以内に1件まで
const candidateBusy = (db: D1Database, reqId: string, cand: string) => db.prepare(`SELECT id FROM recovery_requests WHERE id != ? AND candidate_member_id = ? AND status IN ('pending','merged') AND created_at > ?`).bind(reqId, cand, new Date(Date.now() - 30 * DAY).toISOString()).first()
app.get('/api/admin/recovery/:id/preview', async c => {
  const id = c.req.param('id'), cand = c.req.query('member_id') || '', db = c.env.DB
  const rq = await db.prepare(`SELECT id, status, new_member_id FROM recovery_requests WHERE id = ?`).bind(id).first<any>()
  const o = await db.prepare(`SELECT id, ledger_id FROM members WHERE id = ? AND role = 'owner' AND status = 'active' AND id != ?`).bind(cand, rq?.new_member_id ?? '').first<any>()
  if (!rq || rq.status !== 'pending' || !o) return err(c, 404, '申請または候補が見つかりません') // 閲覧は引き継ぎ申請が出ているときの候補に限る
  if (await candidateBusy(db, id, cand)) return err(c, 400, 'この家計簿を対象にした別の申請があります')
  await db.batch([
    db.prepare('UPDATE recovery_requests SET candidate_member_id = ? WHERE id = ?').bind(cand, id),
    db.prepare(`INSERT INTO audit_log(actor, action, target, created_at) VALUES(?, 'recovery.preview', ?, ?)`).bind(c.get('admin'), `request:${id} candidate:${cand}`, now()), // 閲覧のたびに記録
  ])
  const rows = (await db.prepare(`SELECT t.date, t.type, k.name category, t.amount, t.memo FROM transactions t JOIN categories k ON k.id = t.category_id WHERE t.ledger_id = ? AND t.deleted_at IS NULL ORDER BY t.date DESC, t.created_at DESC LIMIT 100`).bind(o.ledger_id).all()).results
  return c.json({ transactions: rows })
})
app.post('/api/admin/recovery/:id/reject', async c => {
  const id = c.req.param('id'), db = c.env.DB, b = await c.req.json<any>().catch(() => ({}))
  const rq = await db.prepare(`SELECT id, inquiry_id, new_member_id FROM recovery_requests WHERE id = ? AND status = 'pending'`).bind(id).first<any>()
  if (!rq) return err(c, 404, '申請が見つかりません')
  const msg = clip(b.message, 1000) || '本人確認が取れなかったため、引き継ぎはできませんでした。新しい家計簿は、そのままお使いいただけます。'
  await db.batch([
    db.prepare(`UPDATE recovery_requests SET status = 'rejected' WHERE id = ?`).bind(id),
    db.prepare(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'admin', ?, ?)`).bind(rq.inquiry_id, msg, now()),
    db.prepare(`UPDATE inquiries SET status = 'replied' WHERE id = ?`).bind(rq.inquiry_id),
    db.prepare(`INSERT INTO audit_log(actor, action, target, created_at) VALUES(?, 'recovery.reject', ?, ?)`).bind(c.get('admin'), `request:${id}`, now()),
  ])
  bg(c, notifyReply(c.env, rq.new_member_id, rq.inquiry_id, '引き継ぎ申請に返信がありました'))
  return c.json({ ok: true })
})
app.post('/api/admin/recovery/:id/merge', async c => {
  const id = c.req.param('id'), b = await c.req.json<any>(), db = c.env.DB
  const rq = await db.prepare(`SELECT r.*, nm.ledger_id new_ledger, nm.code_hash new_hash, nm.login_id new_login, nm.password_hash new_pw FROM recovery_requests r JOIN members nm ON nm.id = r.new_member_id WHERE r.id = ? AND r.status = 'pending'`).bind(id).first<any>()
  if (!rq) return err(c, 404, '申請が見つかりません')
  const old = await db.prepare(`SELECT id, ledger_id FROM members WHERE id = ? AND role = 'owner' AND status = 'active' AND id != ?`).bind(b.candidate_member_id, rq.new_member_id).first<any>()
  if (!old) return err(c, 400, '統合先の旧オーナーが正しくありません')
  if (await candidateBusy(db, id, old.id)) return err(c, 400, 'この家計簿を対象にした別の申請があります')
  const N = rq.new_ledger, O = old.ledger_id, NM = rq.new_member_id, OM = old.id, t = now(), exp = new Date(Date.now() + 30 * DAY).toISOString()
  const ncats = (await db.prepare('SELECT id, type, name FROM categories WHERE ledger_id = ?').bind(N).all()).results as any[]
  const ocats = (await db.prepare('SELECT id, type, name FROM categories WHERE ledger_id = ?').bind(O).all()).results as any[]
  const P = (sql: string, ...a: any[]) => db.prepare(sql).bind(...a)
  const st = [P('PRAGMA defer_foreign_keys = true')]
  for (const nc of ncats) {
    const oc = ocats.find(o => o.type === nc.type && o.name === nc.name)
    if (oc) st.push( // (種別・名前)が一致する旧カテゴリに付け替える
      P('INSERT OR REPLACE INTO merge_category_map(new_category_id, old_category_id, old_ledger_id, expires_at) VALUES(?,?,?,?)', nc.id, oc.id, O, exp),
      P('UPDATE transactions SET category_id = ? WHERE category_id = ?', oc.id, nc.id),
      P('UPDATE subscriptions SET category_id = ? WHERE category_id = ?', oc.id, nc.id))
    else st.push(P('UPDATE categories SET ledger_id = ? WHERE id = ?', O, nc.id)) // 一致なし: 旧家計簿にカテゴリを追加
  }
  st.push(
    // 予算: 旧家計簿に同じ設定がなければ追加(あれば旧を優先)
    P(`INSERT OR IGNORE INTO budgets(ledger_id, category_id, month, amount) SELECT ?, COALESCE((SELECT old_category_id FROM merge_category_map WHERE new_category_id = b.category_id), b.category_id), b.month, b.amount FROM budgets b WHERE b.ledger_id = ?`, O, N),
    P('DELETE FROM budgets WHERE ledger_id = ?', N),
    // 明細・レシート: 旧家計簿へ移し、入力者を旧オーナーに付け替え(他のメンバーが同期で受け取れるよう更新日時も更新)
    P('UPDATE transactions SET ledger_id = ?, updated_at = ? WHERE ledger_id = ?', O, t, N),
    P('UPDATE transactions SET created_by = ? WHERE ledger_id = ? AND created_by = ?', OM, O, NM),
    P('UPDATE receipts SET ledger_id = ? WHERE ledger_id = ?', O, N),
    P('UPDATE receipts SET created_by = ? WHERE created_by = ?', OM, NM),
    P('UPDATE ledgers SET receipt_bytes = receipt_bytes + (SELECT receipt_bytes FROM ledgers WHERE id = ?) WHERE id = ?', N, O),
    P('UPDATE subscriptions SET ledger_id = ? WHERE ledger_id = ?', O, N),
    P('DELETE FROM categories WHERE ledger_id = ?', N),
    P('UPDATE members SET ledger_id = ? WHERE ledger_id = ? AND id != ?', O, N, NM),
    // セッション(Cookieの値は変えず参照先を変える)・通知の購読・問い合わせ・既読
    P('UPDATE sessions SET member_id = ? WHERE member_id = ?', OM, NM),
    P('UPDATE push_subscriptions SET member_id = ? WHERE member_id = ?', OM, NM),
    P('UPDATE inquiries SET member_id = ? WHERE member_id = ?', OM, NM),
    P('UPDATE device_links SET member_id = ? WHERE member_id = ?', OM, NM),
    P('UPDATE OR IGNORE announcement_reads SET member_id = ? WHERE member_id = ?', OM, NM),
    P('DELETE FROM announcement_reads WHERE member_id = ?', NM),
    P(`UPDATE recovery_requests SET new_member_id = ? WHERE new_member_id = ?`, OM, NM),
    P(`UPDATE recovery_requests SET status = 'merged', merged_at = ?, candidate_member_id = ? WHERE id = ?`, t, OM, id),
    // オーナーコード: 新しいオーナーが控えているコードを、旧オーナーのコードにする
    P('UPDATE members SET login_id = NULL, password_hash = NULL WHERE id = ?', NM), // ログインID・パスワードも新しい方を引き継ぐ
    P('UPDATE members SET login_id = ?, password_hash = ? WHERE id = ?', rq.new_login, rq.new_pw, OM),
    P(`UPDATE members SET code_hash = 'merged-' || id WHERE id = ?`, NM),
    P('UPDATE members SET code_hash = ? WHERE id = ?', rq.new_hash, OM),
    P('DELETE FROM members WHERE id = ?', NM), P('DELETE FROM budget_alerts WHERE ledger_id = ?', N), P('DELETE FROM ledgers WHERE id = ?', N),
    P(`INSERT INTO inquiry_messages(inquiry_id, sender, body, created_at) VALUES(?, 'admin', '引き継ぎが完了しました。以前の家計簿の内容が表示されます。', ?)`, rq.inquiry_id, t),
    P(`UPDATE inquiries SET status = 'replied' WHERE id = ?`, rq.inquiry_id),
    P(`INSERT INTO audit_log(actor, action, target, created_at) VALUES(?, 'recovery.merge', ?, ?)`, c.get('admin'), `request:${id} new:${NM} -> old:${OM}`, t))
  await db.batch(st) // 1回のバッチ(トランザクション)で実行
  bg(c, notifyReply(c.env, OM, rq.inquiry_id, '引き継ぎが完了しました'))
  return c.json({ ok: true })
})

// ---- 家計簿の削除(オーナーのみ) ----
app.delete('/api/ledger', async c => {
  const e = ownerOnly(c); if (e) return e
  const m = c.get('m'), db = c.env.DB, L = m.ledger_id
  const keys = ((await db.prepare('SELECT r2_key FROM receipts WHERE ledger_id = ?').bind(L).all()).results as any[]).map(r => r.r2_key)
  for (let i = 0; i < keys.length; i += 500) await c.env.RECEIPTS.delete(keys.slice(i, i + 500))
  const M = '(SELECT id FROM members WHERE ledger_id = ?)'
  const P = (sql: string, ...a: any[]) => db.prepare(sql).bind(...a)
  await db.batch([
    P('PRAGMA defer_foreign_keys = true'),
    P(`DELETE FROM inquiry_messages WHERE inquiry_id IN (SELECT id FROM inquiries WHERE member_id IN ${M})`, L),
    P(`DELETE FROM recovery_requests WHERE new_member_id IN ${M} OR candidate_member_id IN ${M}`, L, L),
    P(`DELETE FROM inquiries WHERE member_id IN ${M}`, L),
    ...['sessions', 'device_links', 'push_subscriptions', 'announcement_reads'].map(t => P(`DELETE FROM ${t} WHERE member_id IN ${M}`, L)),
    ...['receipts', 'transactions', 'subscriptions', 'budgets', 'budget_alerts', 'categories', 'members'].map(t => P(`DELETE FROM ${t} WHERE ledger_id = ?`, L)),
    P('DELETE FROM ledgers WHERE id = ?', L),
    P(`INSERT INTO audit_log(actor, action, target, created_at) VALUES('system', 'ledger.delete', ?, ?)`, L, now()),
  ])
  setCookie(c, cname(c), '', { httpOnly: true, secure: isHttps(c), sameSite: 'Lax', path: '/', maxAge: 0 })
  return c.json({ ok: true })
})

export default {
  fetch: app.fetch,
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(runCron(env)) },
}
