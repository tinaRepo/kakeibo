import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { yen } from '../api'
import { useCats, useMe } from '../hooks'
import { localTx } from '../offline/local'
import { DetailSearch, PeriodPicker } from '../SearchBar'
import { TxEditor, TxList } from '../TxParts'
import { Seg } from '../ui'

const pad = (n: number) => String(n).padStart(2, '0')
const TYPE_LABEL = { all: '全部', expense: '支出', income: '収入' } as const

// 明細(/detail)。行を押すと編集モーダル(削除はモーダル内のゴミ箱ボタン)
export default function Transactions() {
  const me = useMe().data!, { data: cats = [] } = useCats()
  const [sp, setSp] = useSearchParams(), now = new Date()
  const year = +(sp.get('year') || now.getFullYear()), mon = sp.has('month') ? +sp.get('month')! : now.getMonth() + 1 // 初期表示は今月(0=年間)
  const type = (sp.get('type') || 'all') as 'all' | 'expense' | 'income', q = sp.get('q') || ''
  const put = (o: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(o).forEach(([k, v]) => (v === '' ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }) }
  const from = mon ? `${year}-${pad(mon)}-01` : `${year}-01-01`, to = mon ? `${year}-${pad(mon)}-32` : `${year}-12-32`
  const { data: list = [] } = useQuery<any[]>({ queryKey: ['tx', type, from, to, q], queryFn: () => localTx({ type, from, to, q }) })
  const [editor, setEditor] = useState<any>(undefined) // undefined=閉じる / null=作成 / 行=編集
  // いま効いている条件(初期値と違うもの)
  const periodChanged = year !== now.getFullYear() || mon !== now.getMonth() + 1
  const tags = [...(periodChanged ? [`${year}年${mon ? mon + '月' : ''}`] : []), ...(type !== 'all' ? [TYPE_LABEL[type]] : []), ...(q ? [`備考: ${q}`] : [])]
  const sum = (t: string) => list.filter(x => x.type === t).reduce((a, x) => a + x.amount, 0)
  return (
    <main>
      <PeriodPicker year={year} mon={mon} onChange={(y, m) => put({ year: String(y), month: String(m) })} />
      <DetailSearch tags={tags} onReset={() => setSp({}, { replace: true })}>
        <div className="field">種別<Seg full value={type} options={[['all', '全部'], ['expense', '支出'], ['income', '収入']] as const} onChange={v => put({ type: v === 'all' ? '' : v })} /></div>
        <label className="field">備考のキーワード<input placeholder="例: ランチ" value={q} onChange={e => put({ q: e.target.value })} /></label>
      </DetailSearch>
      {me.perms.tx && <button onClick={() => setEditor(null)}>＋ 作成</button>}
      <p className="mute">{list.length}件{type !== 'income' && `・支出 ${yen(sum('expense'))}`}{type !== 'expense' && `・収入 ${yen(sum('income'))}`}</p>
      {list.length === 0 && <p className="mute">条件に合う明細はありません。「＋ 作成」から入力できます。</p>}
      <TxList rows={list} cats={cats} me={me} onPick={setEditor} />
      {editor !== undefined && <TxEditor init={editor ?? undefined} defaultType={type === 'income' ? 'income' : 'expense'} onClose={() => setEditor(undefined)} />}
    </main>)
}
