import type { QueryClient } from '@tanstack/react-query'
import { api } from '../http'
import { toBase64 } from './b64'
import { db } from './db'

let running = false
let switched = false // 引き継ぎの統合などで家計簿が切り替わった
const now = () => new Date().toISOString()

// 1) 送信待ちキューを送る → 2) 画像を送る → 3) 差分を取得 の順
export async function runSync(qc?: QueryClient): Promise<boolean> {
  if (running || !navigator.onLine) return false
  running = true
  let changed = false, ok = true
  try {
    changed = (await push()) || changed
    changed = (await pushImages()) || changed
    changed = (await pull()) || changed
  } catch (e: any) {
    if (e.status === 401) qc?.resetQueries() // ログイン切れ
    else ok = false // 通信エラーは次の機会に再試行する
  } finally {
    running = false
    if (qc && changed) { qc.invalidateQueries({ queryKey: ['tx'] }); qc.invalidateQueries({ queryKey: ['summary'] }) }
    if (qc && switched) { for (const k of ['me', 'categories', 'subs', 'budgets', 'inq']) qc.invalidateQueries({ queryKey: [k] }) }
    switched = false
  }
  return ok
}

async function push() {
  const ops = await db.outbox.orderBy('seq').limit(200).toArray()
  if (!ops.length) return false
  const { results } = await api('/sync/push', 'POST', { ops: ops.map(o => ({ opId: o.seq, kind: o.kind, id: o.txId, data: o.data })) })
  for (const r of results) {
    const op = ops.find(o => o.seq === r.opId)
    if (!op) continue
    if (r.ok) { await db.outbox.delete(op.seq); continue }
    if (r.status >= 500) continue // サーバー側の一時的な失敗は再試行
    // 権限が外れた・削除済みなど: 「同期エラー」に残し、利用者が再送/破棄を選ぶ
    await db.errors.add({ txId: op.txId, kind: op.kind, data: op.data, error: r.error, at: now() })
    await db.outbox.delete(op.seq)
    if (op.kind === 'upsert') { const t = await db.tx.get(op.txId); if (t?._new) await db.tx.delete(op.txId) }
    await db.kv.put({ k: 'since', v: '' }) // 端末の内容がずれたので、次回は全件を取り直す
  }
  for (const id of new Set(ops.map(o => o.txId)))
    if (!(await db.outbox.where('txId').equals(id).count())) await db.tx.update(id, { _pending: 0, _new: 0 })
  return true
}

async function pushImages() {
  let n = 0
  for (const im of await db.images.toArray()) {
    if (await db.outbox.where('txId').equals(im.txId).count()) continue // 明細の送信が先
    try {
      await api(`/transactions/${im.txId}/receipts`, 'POST', { content_type: im.blob.type, data: await toBase64(im.blob) })
    } catch (e: any) {
      if (!e.status || e.status >= 500 || e.status === 401) throw e
      await db.errors.add({ txId: im.txId, kind: 'image', data: null, error: e.message, at: now() })
    }
    await db.images.delete(im.id); n++
  }
  return n > 0
}

async function pull() {
  let since: string = (await db.kv.get('since'))?.v || ''
  let changed = false
  for (;;) {
    const r = await api('/sync?since=' + encodeURIComponent(since))
    const stored = (await db.kv.get('ledger'))?.v
    if (stored && stored !== r.ledger_id) { // 端末内の控えを作り直す(送信待ちは残し、サーバー側の対応表でカテゴリを付け替える)
      await db.tx.clear(); await db.kv.put({ k: 'ledger', v: r.ledger_id }); await db.kv.put({ k: 'since', v: '' })
      since = ''; changed = true; switched = true; continue
    }
    if (!stored) await db.kv.put({ k: 'ledger', v: r.ledger_id })
    await db.transaction('rw', db.tx, db.kv, db.outbox, async () => {
      const pending = new Set((await db.outbox.toArray()).map(o => o.txId)) // 未送信の変更がある明細は上書きしない
      for (const t of r.transactions) {
        if (pending.has(t.id)) continue
        if (t.deleted_at) await db.tx.delete(t.id)
        else await db.tx.put({ ...t })
      }
      await db.kv.put({ k: 'people', v: r.people })
    })
    if (r.transactions.length) changed = true
    if (!r.more) { await db.kv.put({ k: 'since', v: new Date(Date.parse(r.now) - 5000).toISOString() }); return changed }
    since = r.transactions[r.transactions.length - 1].updated_at
  }
}

// Background Sync(Chrome/Android): アプリを閉じていても、電波が戻ったときにService Workerが送信する。iOSは非対応なので、アプリを開いたときの同期のみ
export function requestBackgroundSync() {
  navigator.serviceWorker?.ready.then(r => (r as any).sync?.register('kakeibo-sync')).catch(() => { /* 非対応 */ })
}
