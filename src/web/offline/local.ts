import { db } from './db'

// 画面の読み取りは常に端末内DBから(オンライン・オフラインで同じ動き)
export async function localTx(p: { type: string; from: string; to: string; q?: string }) {
  const people: any[] = (await db.kv.get('people'))?.v || []
  const q = (p.q || '').toLowerCase()
  const rows = await db.tx.where('date').between(p.from, p.to, true, true)
    .filter(t => (p.type === 'all' || t.type === p.type) && (!q || (t.memo || '').toLowerCase().includes(q))).toArray()
  const imgs = await db.images.toArray()
  rows.sort((a, b) => (a.date === b.date ? (a.created_at < b.created_at ? 1 : -1) : a.date < b.date ? 1 : -1))
  return rows.map(t => ({
    ...t,
    creator: people.find(x => x.id === t.created_by)?.name ?? null,
    rc: (t.receipt_ids ? t.receipt_ids.split(',').length : 0) + imgs.filter(i => i.txId === t.id).length,
  }))
}

// 端末に保存し、送信待ちキューに積む(画像は圧縮済みのBlobを保存)
export async function saveLocal(r: any, blobs: Blob[], meId: string) {
  const t = new Date().toISOString()
  await db.transaction('rw', db.tx, db.outbox, db.images, async () => {
    const ex = await db.tx.get(r.id)
    const data = { type: r.type, date: r.date, category_id: r.category_id, amount: r.amount, memo: r.memo || null }
    await db.tx.put({ ...(ex || { created_by: meId, created_at: t, receipt_ids: null, _new: 1 }), id: r.id, ...data, updated_at: t, _pending: 1 })
    await db.outbox.add({ kind: 'upsert', txId: r.id, data })
    for (const b of blobs) await db.images.add({ id: crypto.randomUUID(), txId: r.id, blob: b })
  })
}
export async function deleteLocal(id: string) {
  await db.transaction('rw', db.tx, db.outbox, db.images, async () => {
    const ex = await db.tx.get(id)
    await db.tx.delete(id)
    await db.images.where('txId').equals(id).delete()
    await db.outbox.bulkDelete((await db.outbox.where('txId').equals(id).toArray()).map(o => o.seq))
    if (!ex?._new) await db.outbox.add({ kind: 'delete', txId: id }) // 未送信の新規なら、サーバーに送る必要がない
  })
}
export async function resendError(e: any, meId: string) {
  if (e.kind === 'delete') await db.outbox.add({ kind: 'delete', txId: e.txId })
  else await saveLocal({ id: e.txId, ...e.data }, [], meId)
  await db.errors.delete(e.id)
}
export const discardError = (id: number) => db.errors.delete(id)
