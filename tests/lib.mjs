// テスト共通: HTTPクライアント(Cookie・クライアントIPを持つ)と結果の集計
export const BASE = process.env.BASE || 'http://127.0.0.1:8788'
let n = 0
export const jar = () => ({ c: '', ip: `10.${(n >> 8) & 255}.${n & 255}.${(n++ % 200) + 1}` }) // クライアントごとに別のIP(レート制限が互いに影響しないように)
export async function req(j, m, p, body, o = {}) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': o.ip || j?.ip || '203.0.113.9', ...(j?.c ? { Cookie: j.c } : {}), ...(o.headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]
  if (o.raw) return { s: r.status, d: await r.text() }
  let d; try { d = await r.json() } catch { d = null }
  return { s: r.status, d }
}
let fails = 0, total = 0
export const ok = (name, cond, extra = '') => { total++; if (!cond) fails++; console.log(cond ? 'OK  ' : 'FAIL', name, cond ? '' : JSON.stringify(extra)) }
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const finish = () => { console.log(fails ? `\n${fails}/${total} 件失敗` : `\n全て成功 (${total}件)`); process.exit(fails ? 1 : 0) }
export const reg = async (name, id, pw = 'password123') => {
  const j = jar(); const r = await req(j, 'POST', '/api/ledgers', { name, login_id: id, password: pw })
  const me = (await req(j, 'GET', '/api/me')).d, cats = (await req(j, 'GET', '/api/categories')).d
  return { j, r, me, cats }
}
export const adm = (m, p, b) => req(null, m, '/api/admin' + p, b)
export const tx = (L, cat, amount, memo = '', date = new Date().toISOString().slice(0, 10)) => req(L.j, 'PUT', '/api/transactions/' + crypto.randomUUID(), { type: 'expense', date, category_id: cat, amount, memo })
