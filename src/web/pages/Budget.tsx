import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onError, yen } from '../api'
import { useCats, useMe } from '../hooks'
import { cached } from '../offline/db'
import { AmountInput, Modal, useConfirm } from '../ui'

export default function Budget() {
  const me = useMe().data!, { data: cats = [] } = useCats(), qc = useQueryClient(), ask = useConfirm()
  const { data: rows } = useQuery<any[]>({ queryKey: ['budgets'], queryFn: () => cached('budgets', () => api('/budgets')) })
  const [scope, setScope] = useState(''), [items, setItems] = useState<Record<string, string>>({}), [err, setErr] = useState('')
  const saved = useMemo(() => { const m: Record<string, string> = {}; (rows || []).forEach(r => (m[`${r.category_id ?? 0}|${r.month ?? ''}`] = String(r.amount))); return m }, [rows])
  useEffect(() => setItems(saved), [saved])
  const exCats = cats.filter(c => c.type === 'expense' && c.is_active)
  const key = (cid: number, sc = scope) => `${cid}|${sc}`
  const val = (cid: number, sc: string) => { const v = items[key(cid, sc)]; return v === '' || v === undefined ? undefined : +v }
  const eff = (cid: number, sc: string) => val(cid, sc) ?? (sc ? val(cid, '') : undefined) // 月の個別指定がなければ基本額
  const label = (sc: string) => (sc ? `${sc}(月の個別指定)` : '毎月の基本額')
  // カテゴリの合計が、全体(合計)と一致していること
  const check = (sc: string) => {
    const sum = exCats.reduce((a, c) => a + (eff(c.id, sc) || 0), 0), total = eff(0, sc)
    if (sum === 0) return null
    if (total === undefined) return `${label(sc)}: カテゴリの予算(合計 ${yen(sum)})がありますが、全体(合計)が未入力です。`
    return total === sum ? null : `${label(sc)}: カテゴリの合計 ${yen(sum)} が、全体(合計) ${yen(total)} と一致しません(差 ${yen(Math.abs(total - sum))})。`
  }
  const nonEmpty = (m: Record<string, string>) => JSON.stringify(Object.entries(m).filter(([, v]) => v !== '').sort())
  const dirty = nonEmpty(items) !== nonEmpty(saved)
  const save = useMutation({
    mutationFn: () => api('/budgets', 'PUT', { items: Object.entries(items).filter(([, v]) => v !== '' && +v >= 0).map(([k, v]) => { const [c, m] = k.split('|'); return { category_id: +c || null, month: m || null, amount: Math.round(+v) } }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budgets'] }); qc.invalidateQueries({ queryKey: ['summary'] }); alert('保存しました') }, onError,
  })
  const onSave = () => {
    const scopes = ['', ...new Set(Object.entries(items).filter(([, v]) => v !== '').map(([k]) => k.split('|')[1]).filter(Boolean))]
    for (const sc of scopes) { const e = check(sc); if (e) return setErr(e) }
    save.mutate()
  }
  const sumNow = exCats.reduce((a, c) => a + (eff(c.id, scope) || 0), 0), totalNow = eff(0, scope)
  return (
    <main><h1>予算</h1>
      <div className="row"><button className={scope === '' ? '' : 'sub'} onClick={() => setScope('')}>毎月の基本額</button>
        <label>特定の月だけ <input type="month" value={scope} onChange={e => setScope(e.target.value)} /></label></div>
      <p className="mute">{scope ? `${scope} だけ基本額を上書きします。空欄なら基本額が使われます。` : '毎月の予算です。年間予算は12か月分の合計になります。'}</p>
      {[{ id: 0, name: '全体(合計)' }, ...exCats].map(c =>
        <div className="item" key={c.id}><span>{c.name}</span>
          <AmountInput disabled={!me.perms.budget} value={items[key(c.id)] ?? ''} onChange={v => setItems({ ...items, [key(c.id)]: v })} /></div>)}
      <p className="mute">カテゴリの合計 {yen(sumNow)} / 全体(合計) {totalNow === undefined ? '未入力' : yen(totalNow)}{sumNow > 0 && totalNow !== sumNow ? '(一致していません)' : ''}</p>
      {me.perms.budget && <p><button disabled={save.isPending || !dirty} onClick={onSave}>保存</button>
        <button className="sub" disabled={!dirty} onClick={() => ask('入力中の変更を破棄して、保存済みの内容に戻します。', { ok: 'リセット' }).then(ok => ok && setItems(saved))}>リセット</button></p>}
      {err && <Modal title="予算を保存できません" onClose={() => setErr('')}><p>{err}</p><p className="mute">カテゴリの合計と全体(合計)を一致させてから、もう一度保存してください。</p><div className="row end"><button onClick={() => setErr('')}>OK</button></div></Modal>}
    </main>)
}
