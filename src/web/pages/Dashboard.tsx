import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Chart as CJ, ArcElement, Tooltip, Legend } from 'chart.js'
import { Pie } from 'react-chartjs-2'
import { api, yen } from '../api'
import { useCats } from '../hooks'
import { cached } from '../offline/db'
import { TxEditor } from '../TxParts'
import { DetailSearch, PeriodPicker } from '../SearchBar'
import { Bar, Seg, catIcon } from '../ui'
import Breakdown, { COLORS } from './Breakdown'
CJ.register(ArcElement, Tooltip, Legend)

export default function Dashboard() {
  const [sp, setSp] = useSearchParams(), now = new Date()
  const year = +(sp.get('year') || now.getFullYear()), mon = sp.has('month') ? +sp.get('month')! : now.getMonth() + 1 // 初期表示は今月(0=年間)
  const type = (sp.get('type') || 'all') as 'all' | 'expense' | 'income'
  const sel = (sp.get('cats') || '').split(',').filter(Boolean).map(Number)
  const put = (o: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(o).forEach(([k, v]) => (v === '' ? n.delete(k) : n.set(k, v))); setSp(n, { replace: true }) }
  const toggle = (id: number) => put({ cats: (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]).join(',') })
  const [creating, setCreating] = useState(false), [detail, setDetail] = useState<'expense' | 'income' | null>(null)
  const { data: cats = [] } = useCats()
  const { data: s, isLoading } = useQuery({ queryKey: ['summary', year], queryFn: () => cached('summary:' + year, () => api('/summary/year?year=' + year)) })
  if (isLoading || !s) return <main>読み込み中…</main>
  const allMonths = Object.keys(s.months), yms = allMonths.filter((_, i) => !mon || i + 1 === mon)
  const inSel = (id: number) => !sel.length || sel.includes(id)
  const sum = (t: string, cid: number, list = yms) => list.reduce((a, ym) => a + (s.months[ym][t][cid] || 0), 0)
  const ex = cats.filter(c => c.type === 'expense' && inSel(c.id)), inc = cats.filter(c => c.type === 'income' && inSel(c.id))
  const tot = (l: any[], t: string, list = yms) => l.reduce((a, c) => a + sum(t, c.id, list), 0)
  const exT = tot(ex, 'expense'), inT = tot(inc, 'income')
  const subT = yms.reduce((a, ym) => a + Object.entries<number>(s.months[ym].subs).filter(([id]) => inSel(+id)).reduce((x, [, y]) => x + y, 0), 0)
  const bud = (cid: number) => yms.reduce((a, ym) => a + (s.budget[ym][cid] || 0), 0)
  const rows = [...(sel.length ? [] : [{ id: 0, name: '全体', spent: exT, b: bud(0) }]), ...ex.map(c => ({ id: c.id, name: c.name, spent: sum('expense', c.id), b: bud(c.id) }))].filter(r => r.b > 0)
  const pieBox = (t: 'expense' | 'income', title: string, list: any[]) => {
    const d = list.map(c => ({ n: c.name, v: sum(t, c.id) })).filter(x => x.v > 0)
    return (
      <div key={t}><h2 className="center" style={{ marginTop: 0 }}>{title}</h2>
        {d.length ? <><div className="pie tap" role="button" tabIndex={0} aria-label={`${title}。タップすると内訳と明細を表示`} onClick={() => setDetail(t)} onKeyDown={e => e.key === 'Enter' && setDetail(t)}>
          <Pie data={{ labels: d.map(x => x.n), datasets: [{ data: d.map(x => x.v), backgroundColor: COLORS, borderWidth: 0 }] }} options={{ events: [] }} /></div>
          <p className="mute center">タップして明細を表示</p></> : <p className="mute center">データがありません</p>}
      </div>)
  }
  const tableT = type === 'income' ? 'income' : 'expense', tableCats = tableT === 'income' ? inc : ex
  const monthTotals = allMonths.map(ym => tableCats.reduce((a, c) => a + (s.months[ym][tableT][c.id] || 0), 0))
  const chipCats = cats.filter(c => c.is_active && (type === 'all' || c.type === type))
  const label = `${year}年${mon ? mon + '月' : ''}`
  // いま効いている条件(初期値と違うもの)
  const periodChanged = year !== now.getFullYear() || mon !== now.getMonth() + 1
  const tags = [...(periodChanged ? [label] : []), ...(type !== 'all' ? [type === 'expense' ? '支出' : '収入'] : []),
  ...(sel.length ? [sel.length <= 2 ? cats.filter(c => sel.includes(c.id)).map(c => c.name).join('・') : `カテゴリ ${sel.length}件`] : [])]
  return (<>
    <section className="tile"><div className="tile-in">
      <PeriodPicker year={year} mon={mon} onChange={(y, m) => put({ year: String(y), month: String(m) })} />
      <DetailSearch tags={tags} onReset={() => setSp({}, { replace: true })}>
        <div className="field">種別<Seg full value={type} options={[['all', '全部'], ['expense', '支出'], ['income', '収入']] as const} onChange={v => put({ type: v === 'all' ? '' : v, cats: '' })} /></div>
        <div className="field">カテゴリ(複数選択できます)
          <div className="chips">{chipCats.map(c => <button key={c.id} className={'chip' + (sel.includes(c.id) ? ' on' : '')} aria-pressed={sel.includes(c.id)} onClick={() => toggle(c.id)}>{catIcon(c)} {c.name}</button>)}</div></div>
      </DetailSearch>
      <p className="tagline">{label}の{type === 'income' ? '収入' : '支出'}</p><p className="hero">{yen(type === 'income' ? inT : exT)}</p>
      {type === 'all' && <p className="lead">収入 {yen(inT)}　収支 {yen(inT - exT)}</p>}
      {type !== 'income' && <p className="mute">うちサブスク {yen(subT)}</p>}
      <button onClick={() => setCreating(true)}>＋ 作成</button>
    </div></section>
    {type !== 'income' && rows.length > 0 && <section className="tile dark"><div className="tile-in"><h2 style={{ marginTop: 0 }}>予算の進捗</h2>
      {rows.map(r => <div key={r.id} style={{ margin: '16px 0' }}>
        <div className="item" style={{ border: 0, padding: 0 }}><span>{r.name}</span><span className="mute">{yen(r.spent)} / {yen(r.b)}(残り {yen(r.b - r.spent)})</span></div><Bar spent={r.spent} budget={r.b} /></div>)}
    </div></section>}
    <section className="tile parchment"><div className="tile-in grid2">
      {type !== 'income' && pieBox('expense', '支出の内訳', ex)}{type !== 'expense' && pieBox('income', '収入の内訳', inc)}
    </div></section>
    <section className="tile"><div className="tile-in"><h2 style={{ marginTop: 0 }}>{year}年 カテゴリ × 月({tableT === 'income' ? '収入' : '支出'})</h2><div className="scroll"><table>
      <thead><tr><th>カテゴリ</th>{allMonths.map((_, i) => <th key={i}>{i + 1}月</th>)}<th>合計</th></tr></thead>
      <tbody>{tableCats.map(c => <tr key={c.id}><td>{c.name}</td>{allMonths.map(ym => <td key={ym}>{(s.months[ym][tableT][c.id] || 0).toLocaleString()}</td>)}<td>{tot([c], tableT, allMonths).toLocaleString()}</td></tr>)}
        <tr className="total"><td>合計</td>{monthTotals.map((v, i) => <td key={i}>{v.toLocaleString()}</td>)}<td>{monthTotals.reduce((a, b) => a + b, 0).toLocaleString()}</td></tr></tbody></table></div></div></section>
    {creating && <TxEditor defaultType={type === 'income' ? 'income' : 'expense'} onClose={() => setCreating(false)} />}
    {detail && <Breakdown type={detail} year={year} mon={mon} catIds={(detail === 'expense' ? ex : inc).map(c => c.id)} s={s} onClose={() => setDetail(null)} />}
  </>)
}
