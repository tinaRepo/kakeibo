import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pie } from 'react-chartjs-2'
import { api, yen } from '../api'
import { useCats, useMe } from '../hooks'
import { cached } from '../offline/db'
import { localTx } from '../offline/local'
import { TxEditor, TxList } from '../TxParts'
import { Modal, catIcon } from '../ui'

export const COLORS = ['#0066cc', '#34c759', '#ff9f0a', '#ff3b30', '#af52de', '#5ac8fa', '#ff2d55', '#a2845e', '#8e8e93', '#30b0c7', '#5856d6', '#ffcc00']
const pad = (n: number) => String(n).padStart(2, '0')

// 円グラフをタップしたときの画面: 円グラフ + その下に明細(スライス/凡例をタップするとカテゴリで絞り込み)
export default function Breakdown({ type, year, mon, catIds, s, onClose }: { type: 'expense' | 'income'; year: number; mon: number; catIds: number[]; s: any; onClose: () => void }) {
  const me = useMe().data!, { data: cats = [] } = useCats()
  const [pick, setPick] = useState<number | null>(null), [edit, setEdit] = useState<any>(null)
  const yms = Object.keys(s.months).filter((_, i) => !mon || i + 1 === mon)
  const own = cats.filter(c => c.type === type && catIds.includes(c.id))
  const slices = own.map(c => ({ c, v: yms.reduce((a, ym) => a + (s.months[ym][type][c.id] || 0), 0) })).filter(x => x.v > 0)
  const from = mon ? `${year}-${pad(mon)}-01` : `${year}-01-01`, to = mon ? `${year}-${pad(mon)}-32` : `${year}-12-32`
  const { data: txs = [] } = useQuery<any[]>({ queryKey: ['tx', 'bd', type, from, to], queryFn: () => localTx({ type, from, to }) })
  const { data: subs = [] } = useQuery<any[]>({ queryKey: ['subs'], queryFn: () => cached('subs', () => api('/subscriptions')) })
  const subRows = type === 'expense' ? yms.flatMap(ym => subs.filter(x => x.start_date <= ym + '-31' && (!x.end_date || x.end_date >= ym + '-01'))
    .map(x => ({ id: `sub-${x.id}-${ym}`, ro: true, type, date: ym + '-01', category_id: x.category_id, amount: x.amount, memo: `サブスク: ${x.name}`, created_by: me.id }))) : []
  const rows = [...txs, ...subRows].filter(t => catIds.includes(t.category_id) && (pick === null || t.category_id === pick))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const shown = rows.reduce((a, t) => a + t.amount, 0)
  return (
    <Modal wide title={`${year}年${mon ? mon + '月' : ''}の${type === 'expense' ? '支出' : '収入'}`} onClose={onClose}>
      {slices.length ? <div className="pie"><Pie data={{ labels: slices.map(x => x.c.name), datasets: [{ data: slices.map(x => x.v), backgroundColor: COLORS, borderWidth: 0 }] }}
        options={{ plugins: { legend: { display: false } }, onClick: (_e, els) => els[0] && setPick(p => (p === slices[els[0].index].c.id ? null : slices[els[0].index].c.id)) }} /></div> : <p className="mute">データがありません</p>}
      <div className="chips">
        <button className={'chip' + (pick === null ? ' on' : '')} onClick={() => setPick(null)}>すべて</button>
        {slices.map((x, i) => <button key={x.c.id} className={'chip' + (pick === x.c.id ? ' on' : '')} onClick={() => setPick(pick === x.c.id ? null : x.c.id)}>
          <span style={{ color: COLORS[i % COLORS.length] }}>●</span>&nbsp;{catIcon(x.c)} {x.c.name} {yen(x.v)}</button>)}
      </div>
      <p className="mute">{rows.length}件・合計 {yen(shown)}{type === 'expense' && '(サブスクを含む)'}</p>
      <TxList rows={rows} cats={cats} me={me} onPick={setEdit} />
      {edit && <TxEditor init={edit} onClose={() => setEdit(null)} />}
      <div className="row end"><button className="sub" onClick={onClose}>閉じる</button></div>
    </Modal>)
}
