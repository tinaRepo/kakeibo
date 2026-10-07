import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import { api, onError } from '../api'
import { useMe } from '../hooks'
import { Modal, useConfirm } from '../ui'

const PERMS: [string, string][] = [['can_tx', '明細編集'], ['can_category', 'カテゴリ編集'], ['can_sub', 'サブスク編集'], ['can_budget', '予算編集']]
const ALL = { can_tx: true, can_category: true, can_sub: true, can_budget: true } // 権限の初期値はすべてON

export default function Members() {
  const me = useMe().data!, qc = useQueryClient(), ask = useConfirm()
  const [form, setForm] = useState<any>(null), [issued, setIssued] = useState<{ code: string; note: string } | null>(null)
  const { data: list = [] } = useQuery<any[]>({ queryKey: ['members'], queryFn: () => api('/members'), enabled: me.role === 'owner' })
  const inv = () => qc.invalidateQueries({ queryKey: ['members'] })
  // 招待は「備考と権限を決めてから」コードを発行する
  const invite = useMutation({ mutationFn: (f: any) => api('/members/invite', 'POST', { note: f.note, ...Object.fromEntries(PERMS.map(([k]) => [k, f[k]])) }),
    onSuccess: (r: any, f: any) => { setForm(null); setIssued({ code: r.code, note: f.note }); inv() }, onError })
  const update = useMutation({ mutationFn: (f: any) => api('/members/' + f.id, 'PUT', { note: f.note, ...Object.fromEntries(PERMS.map(([k]) => [k, f[k]])) }), onSuccess: () => { setForm(null); inv() }, onError })
  const reissue = useMutation({ mutationFn: (f: any) => api('/members/' + f.id, 'PUT', { reissue: true }), onSuccess: (r: any, f: any) => { setForm(null); setIssued({ code: r.code, note: f.note }); inv() }, onError })
  const del = useMutation({ mutationFn: (id: string) => api('/members/' + id, 'DELETE'), onSuccess: () => { setForm(null); inv() }, onError })
  if (me.role !== 'owner') return <Navigate to="/settings" replace />
  const users = list.filter(m => m.role === 'user')
  const all = form && PERMS.every(([k]) => form[k])
  return (
    <main><Link to="/settings">‹ 設定</Link><h1>メンバー管理</h1>
      <button onClick={() => setForm({ note: '', ...ALL })}>＋ 招待</button>
      {users.length === 0 && <p className="mute">まだメンバーがいません。「＋ 招待」で、備考と権限を決めてからコードを発行できます(最大9人)。</p>}
      {users.map(u => (
        <div className="item" key={u.id}>
          <div style={{ minWidth: 0 }}><div><b>{u.note || '(備考なし)'}</b> <span className="mute">{u.name ? `表示名: ${u.name}` : 'コード未使用'}</span></div>
            <div className="mute">権限: {PERMS.filter(([k]) => u[k]).map(([, l]) => l).join('・') || '閲覧のみ'}</div></div>
          <div><button className="sub sm" onClick={() => setForm({ ...u })}>編集</button>
            <button className="sub sm" onClick={() => ask(`${u.note || u.name || 'このメンバー'}を削除(無効化)します。入力した明細は残ります。`, { ok: '削除', danger: true }).then(ok => ok && del.mutate(u.id))}>削除</button></div>
        </div>))}
      {form && <Modal title={form.id ? 'メンバーを編集' : 'メンバーを招待'} onClose={() => setForm(null)}>
        <label className="field">備考(誰用か分かるように)<input maxLength={50} placeholder="例: 妻、長男のスマホ" value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        <div className="field">権限(閲覧は常に有効)
          <label className="row"><input type="checkbox" checked={all} onChange={e => setForm({ ...form, ...Object.fromEntries(PERMS.map(([k]) => [k, e.target.checked])) })} />全て</label>
          {PERMS.map(([k, l]) => <label className="row" key={k}><input type="checkbox" checked={!!form[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} />{l}</label>)}</div>
        {form.id && <button className="sub" onClick={() => ask('古いコードは使えなくなります。再発行しますか?', { ok: '再発行' }).then(ok => ok && reissue.mutate(form))}>コードを再発行</button>}
        <div className="row end"><button className="sub" onClick={() => setForm(null)}>キャンセル</button>
          {form.id ? <button disabled={update.isPending} onClick={() => update.mutate(form)}>保存</button> : <button disabled={invite.isPending} onClick={() => invite.mutate(form)}>コードを発行</button>}</div>
      </Modal>}
      {issued && <Modal title="ユーザーコード" onClose={() => setIssued(null)}>
        <p>{issued.note ? `「${issued.note}」用のコードです。` : ''}再表示できません。共有する相手に渡してください。</p>
        <code className="code">{issued.code}</code>
        <div className="row end"><button className="sub" onClick={() => navigator.clipboard.writeText(issued.code)}>コピー</button><button onClick={() => setIssued(null)}>閉じる</button></div>
      </Modal>}
    </main>)
}
