import { ReactNode, useState } from 'react'

// 期間(年 ‹ › と 月/年間)。集計と明細で共通
export function PeriodPicker({ year, mon, onChange }: { year: number; mon: number; onChange: (year: number, mon: number) => void }) {
  return (
    <div className="row">
      <button className="sub" aria-label="前の年" onClick={() => onChange(year - 1, mon)}>‹</button><b>{year}年</b><button className="sub" aria-label="次の年" onClick={() => onChange(year + 1, mon)}>›</button>
      <select aria-label="表示する月" value={mon} onChange={e => onChange(year, +e.target.value)}>
        <option value={0}>年間</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}月</option>)}</select>
    </div>)
}

// 「詳細検索」: 押すと、隠れていた検索条件が開く。閉じていても、いま効いている条件を表示し、まとめてリセットできる
export function DetailSearch({ tags, onReset, children }: { tags: string[]; onReset: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="search">
      <div className="row">
        <button type="button" className="sub" aria-expanded={open} onClick={() => setOpen(!open)}>詳細検索 {open ? '▲' : '▼'}{tags.length > 0 && <span className="badge">{tags.length}</span>}</button>
        {tags.length > 0 && <button type="button" className="sub" onClick={onReset}>条件をリセット</button>}
      </div>
      {!open && tags.length > 0 && <div className="chips">{tags.map(t => <span className="tag" key={t}>{t}</span>)}</div>}
      {open && <div className="panel">{children}</div>}
    </div>)
}
