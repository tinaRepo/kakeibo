// 端末内DB(IndexedDB)と同期のロジックを、擬似IndexedDBでAPIサーバーにつないで確認する
import 'fake-indexeddb/auto'
import { QueryClient } from '@tanstack/react-query'
const BASE = process.env.BASE!
let online = true, cookie = ''
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online } }, configurable: true })
const realFetch = globalThis.fetch
globalThis.fetch = ((u: any, i: any = {}) => realFetch(BASE + u, { ...i, headers: { ...i.headers, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.201' } })) as any
const api = async (p: string, m = 'GET', b?: any) => { const r = await realFetch(BASE + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.201' }, body: b && JSON.stringify(b) }); return r.json() }
const reg = await realFetch(BASE + '/api/ledgers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '203.0.113.201' }, body: JSON.stringify({ name: '同期', login_id: 'sync_user1', password: 'password123' }) })
cookie = reg.headers.get('set-cookie')!.split(';')[0]
const { db } = await import('../src/web/offline/db.ts')
const { saveLocal, deleteLocal, localTx } = await import('../src/web/offline/local.ts')
const { runSync } = await import('../src/web/offline/sync.ts')
const qc = new QueryClient(), cat = (await api('/categories'))[0].id
let fails = 0
const ok = (n: string, c: boolean, x: any = '') => { if (!c) fails++; console.log(c ? 'OK  ' : 'FAIL', n, c ? '' : JSON.stringify(x)) }
const mk = (id: string, amount: number) => ({ id, type: 'expense', date: '2026-10-03', category_id: cat, amount, memo: 'm' })
const [A, B, C] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
await saveLocal(mk(A, 100), [], 'me'); ok('同期の結果を返す(成功=true)', (await runSync(qc)) === true)
ok('送信後に未同期フラグが外れ、サーバーに存在', !(await db.tx.get(A))?._pending && (await db.outbox.count()) === 0 && (await api('/transactions?year=2026')).some((t: any) => t.id === A))
online = false
await saveLocal(mk(B, 200), [], 'me'); await saveLocal(mk(A, 150), [], 'me'); await deleteLocal(B)
await saveLocal(mk(C, 300), [new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' })], 'me')
ok('オフライン中は送らない', (await runSync(qc)) === false && (await db.outbox.count()) === 2)
ok('未送信の新規を削除するとキューから消える', !(await db.tx.get(B)))
online = true; await runSync(qc)
const srv = await api('/transactions?year=2026')
ok('編集・画像が反映、Bは存在しない', srv.find((t: any) => t.id === A)?.amount === 150 && !srv.some((t: any) => t.id === B) && !!srv.find((t: any) => t.id === C)?.receipt_ids)
ok('キューと画像が空', (await db.outbox.count()) === 0 && (await db.images.count()) === 0)
await api('/transactions/' + A, 'DELETE')
await saveLocal(mk(A, 999), [], 'me'); await runSync(qc)
ok('他端末で削除済みの明細を編集 → 同期エラーに残る', (await db.errors.toArray()).length === 1, await db.errors.toArray())
await runSync(qc)
ok('全件取り直しで、削除済みが端末から消える', !(await db.tx.get(A)))
await api('/transactions/' + crypto.randomUUID(), 'PUT', { type: 'expense', date: '2026-10-04', category_id: cat, amount: 500, memo: 'other' })
await runSync(qc)
ok('他端末の追加を差分取得', (await localTx({ type: 'all', from: '2026-10-01', to: '2026-10-32', q: 'other' })).length === 1)
console.log(fails ? `\n${fails}件失敗` : '\n全て成功'); process.exit(fails ? 1 : 0)
