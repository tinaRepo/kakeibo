import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onError, today, yen } from '../api'
import { useCats, useMe } from '../hooks'
import { cached } from '../offline/db'
import { AmountInput, Modal, catIcon, useConfirm } from '../ui'

export default function Subscriptions() {
  const me = useMe().data!, { data: cats = [] } = useCats(), qc = useQueryClient(), ask = useConfirm()
  const { data: list = [] } = useQuery<any[]>({ queryKey: ['subs'], queryFn: () => cached('subs', () => api('/subscriptions')) })
  const [f, setF] = useState<any>(null)
  const done = () => { qc.invalidateQueries({ queryKey: ['subs'] }); qc.invalidateQueries({ queryKey: ['summary'] }) }
  const save = useMutation({
    mutationFn: (f: any) => api('/subscriptions' + (f.id ? '/' + f.id : ''), f.id ? 'PUT' : 'POST', { ...f, category_id: +f.category_id, amount: +f.amount }),
    onSuccess: () => { setF(null); done() }, onError,
  })
  const del = useMutation({ mutationFn: (id: number) => api('/subscriptions/' + id, 'DELETE'), onSuccess: done, onError })
  const ex = cats.filter(c => c.type === 'expense' && c.is_active)
  const year = new Date().getFullYear()
  const paid = (s: any) => { let n = 0; for (let m = 1; m <= 12; m++) { const ym = `${year}-${String(m).padStart(2, '0')}`; if (s.start_date <= ym + '-31' && (!s.end_date || s.end_date >= ym + '-01')) n++ } return n * s.amount }
  const blank = () => ({ name: '', category_id: ex[0]?.id ?? '', amount: '', start_date: today(), end_date: '', memo: '' })
  return (
    <main><h1>サブスク</h1>
      {me.perms.sub && <button onClick={() => setF(blank())}>＋ 作成</button>}
      {list.length === 0 && <p className="mute">サブスクはまだありません。</p>}
      {list.map(s => <div className="tx" key={s.id}><span className="ico" aria-hidden>{catIcon(cats.find(c => c.id === s.category_id))}</span>
        <div className="tx-body">
          <div className="tx-top"><span>{s.name}</span><b>{yen(s.amount)}/月</b></div>
          <div className="mute">{s.end_date && s.end_date < today() ? '解約済み' : '継続中'}・{year}年の支払額 {yen(paid(s))}</div>
          {s.memo && <div className="mute">{s.memo}</div>}
          {me.perms.sub && <div><button className="sub sm" onClick={() => setF({ ...s, amount: String(s.amount), end_date: s.end_date || '', memo: s.memo || '' })}>編集</button>
            <button className="sub sm" onClick={() => ask('このサブスクを削除しますか?', { ok: '削除', danger: true }).then(ok => ok && del.mutate(s.id))}>削除</button></div>}
        </div></div>)}
      {f && <Modal title={f.id ? 'サブスクを編集' : 'サブスクを作成'} onClose={() => setF(null)}>
        <label className="field">サービス名<input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">カテゴリ<select value={f.category_id} onChange={e => setF({ ...f, category_id: e.target.value })}>{ex.map(c => <option key={c.id} value={c.id}>{catIcon(c)} {c.name}</option>)}</select></label>
        <div className="field">月額<AmountInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></div>
        <label className="field">契約開始日<input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /></label>
        <label className="field">解約日(空欄=継続中)<input type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} /></label>
        <label className="field">備考<input value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} /></label>
        <div className="row end"><button className="sub" onClick={() => setF(null)}>キャンセル</button>
          <button disabled={save.isPending || !f.name.trim() || f.amount === '' || !f.category_id} onClick={() => save.mutate(f)}>保存</button></div>
      </Modal>}
    </main>)
}
