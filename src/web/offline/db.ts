import Dexie, { Table } from 'dexie'

// 端末内DB: 明細の控え / 送信待ちキュー / 同期エラー / 送信待ち画像 / キャッシュ(kv)
class DB extends Dexie {
  tx!: Table<any, string>
  outbox!: Table<any, number>
  errors!: Table<any, number>
  images!: Table<any, string>
  kv!: Table<{ k: string; v: any }, string>
  constructor() {
    super('kakeibo')
    this.version(1).stores({ tx: 'id,date,updated_at', outbox: '++seq,txId', errors: '++id', images: 'id,txId', kv: 'k' })
  }
}
export const db = new DB()

// ネットワーク優先。通信できないときだけ、最後に取得した内容を返す(HTTPエラーはそのまま投げる)
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    const v = await fn()
    await db.kv.put({ k: key, v })
    return v
  } catch (e: any) {
    if (e.status) throw e
    const hit = await db.kv.get(key)
    if (hit) return hit.v as T
    throw e
  }
}
export async function clearLocal() {
  await Promise.all(db.tables.map(t => t.clear()))
  if ('caches' in self) await caches.delete('receipts')
}
