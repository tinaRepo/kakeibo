import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { yen } from './api'

export function Bar({ spent, budget }: { spent: number; budget: number }) {
  const p = budget ? (spent / budget) * 100 : 0
  return <div className="bar"><i className={p > 100 ? 'o' : p >= 80 ? 'w' : ''} style={{ width: Math.min(p, 100) + '%' }} /></div>
}
export const catIcon = (c?: { icon?: string | null }) => c?.icon || '🏷️'

export function Modal({ title, onClose, children, action, wide }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className={'modal' + (wide ? ' wide' : '')} aria-label={title} onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === ref.current) onClose() }}>
      <div className="modal-in"><div className="modal-head"><h2 style={{ margin: 0 }}>{title}</h2>{action}</div>{children}</div>
    </dialog>)
}

type Ask = (message: string, o?: { ok?: string; danger?: boolean }) => Promise<boolean>
const Ctx = createContext<Ask>(async () => false)
export const useConfirm = () => useContext(Ctx)
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [q, setQ] = useState<null | { message: string; ok: string; danger: boolean; resolve: (v: boolean) => void }>(null)
  const ask: Ask = useCallback((message, o = {}) => new Promise(resolve => setQ({ message, ok: o.ok || 'OK', danger: !!o.danger, resolve })), [])
  const done = (v: boolean) => { q?.resolve(v); setQ(null) }
  return (
    <Ctx.Provider value={ask}>{children}
      {q && <Modal title="確認" onClose={() => done(false)}><p>{q.message}</p>
        <div className="row end"><button className="sub" onClick={() => done(false)}>キャンセル</button><button className={q.danger ? 'danger' : ''} onClick={() => done(true)}>{q.ok}</button></div></Modal>}
    </Ctx.Provider>)
}

// 金額入力: ¥とカンマ区切りで表示、−/＋(または↑↓キー)で100円単位
export function AmountInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const n = value === '' ? 0 : +value
  const step = (d: number) => onChange(String(Math.max(0, n + d)))
  return (
    <span className="amount">
      <button type="button" className="sub" aria-label="100円減らす" disabled={disabled} onClick={() => step(-100)}>−</button>
      <input inputMode="numeric" aria-label="金額" placeholder="¥0" disabled={disabled} value={value === '' ? '' : yen(n)}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10))}
        onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); step(100) } else if (e.key === 'ArrowDown') { e.preventDefault(); step(-100) } }} />
      <button type="button" className="sub" aria-label="100円増やす" disabled={disabled} onClick={() => step(100)}>＋</button>
    </span>)
}

export const TrashIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" /></svg>
// 支出/収入/全部 などの切り替え
export function Seg<T extends string>({ value, options, onChange, full }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; full?: boolean }) {
  return <span className={'seg' + (full ? ' full' : '')} role="group">{options.map(([v, l]) => <button key={v} type="button" className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</span>
}
