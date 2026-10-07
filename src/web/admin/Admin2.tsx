import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api, onError, yen } from '../api'
import { Modal, useConfirm } from '../ui'
import { fmt } from '../Thread'

const Err = ({ e }: { e: unknown }) => (e ? <p className="mute">{(e as Error).message}(Cloudflare Accessでログインしているか確認してください)</p> : null)
const TARGET: Record<string, string> = { all: '全員', owner: 'オーナー', user: 'ユーザー' }
const toLocal = (iso: string) => new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export function Announcements() {
  const qc = useQueryClient(), ask = useConfirm(), [f, setF] = useState<any>(null)
  const { data = [], error } = useQuery<any[]>({ queryKey: ['a-ann'], queryFn: () => api('/admin/announcements') })
  const inv = () => qc.invalidateQueries({ queryKey: ['a-ann'] })
  const save = useMutation({
    mutationFn: (f: any) => { const b = { title: f.title, body: f.body, target: f.target, send_push: f.send_push, publish_at: f.publish_at ? new Date(f.publish_at).toISOString() : undefined }
      return f.id ? api('/admin/announcements/' + f.id, 'PUT', b) : api('/admin/announcements', 'POST', b) },
    onSuccess: () => { setF(null); inv() }, onError,
  })
  const del = useMutation({ mutationFn: (id: number) => api('/admin/announcements/' + id, 'DELETE'), onSuccess: inv, onError })
  return (
    <main><h1>お知らせ管理</h1>
      <button onClick={() => setF({ title: '', body: '', target: 'all', send_push: false, publish_at: '' })}>＋ 作成</button><Err e={error} />
      {data.map(a => <div className="item" key={a.id}>
        <div style={{ minWidth: 0 }}><div><b>{a.title}</b> <span className="mute">{TARGET[a.target]}</span></div>
          <div className="mute">{new Date(a.publish_at) > new Date() ? '予約' : '公開中'}・{fmt(a.publish_at)}・{a.send_push ? (a.pushed_at ? '通知済み' : '通知待ち') : '通知なし'}</div></div>
        <div><button className="sub sm" onClick={() => setF({ ...a, send_push: !!a.send_push, publish_at: toLocal(a.publish_at) })}>編集</button>
          <button className="sub sm" onClick={() => ask('このお知らせを削除しますか?', { ok: '削除', danger: true }).then(ok => ok && del.mutate(a.id))}>削除</button></div></div>)}
      {f && <Modal title={f.id ? 'お知らせを編集' : 'お知らせを作成'} onClose={() => setF(null)}>
        <label className="field">タイトル<input maxLength={100} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field">本文({f.body.length}/2000)<textarea maxLength={2000} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        <label className="field">配信対象<select value={f.target} onChange={e => setF({ ...f, target: e.target.value })}>{Object.entries(TARGET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">配信日時(空欄 = いますぐ)<input type="datetime-local" value={f.publish_at} onChange={e => setF({ ...f, publish_at: e.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={f.send_push} onChange={e => setF({ ...f, send_push: e.target.checked })} />プッシュ通知も送る</label>
        <div className="row end"><button className="sub" onClick={() => setF(null)}>キャンセル</button><button disabled={save.isPending || !f.title.trim() || !f.body.trim()} onClick={() => save.mutate(f)}>保存</button></div>
      </Modal>}
    </main>)
}

const RS: Record<string, string> = { pending: '確認待ち', merged: '統合済み', rejected: '却下' }
export function RecoveryList() {
  const { data = [], error } = useQuery<any[]>({ queryKey: ['a-rec'], queryFn: () => api('/admin/recovery') })
  return (
    <main><h1>復旧申請</h1><Err e={error} />{!error && data.length === 0 && <p className="mute">申請はありません。</p>}
      {data.map(r => <Link key={r.id} to={'/admin/recovery/' + r.id} style={{ color: 'inherit', textDecoration: 'none' }}>
        <div className="item"><div><b>{r.new_name || '(未設定)'}</b> <span className="mute">{RS[r.status]}・{fmt(r.created_at)}</span></div></div></Link>)}
    </main>)
}

export function RecoveryDetail() {
  const { id } = useParams(), qc = useQueryClient(), ask = useConfirm(), [name, setName] = useState(''), [q, setQ] = useState<string | null>(null), [pv, setPv] = useState<{ who: string; rows: any[] } | null>(null)
  const { data: r, error } = useQuery<any>({ queryKey: ['a-rec', id], queryFn: () => api('/admin/recovery/' + id) })
  const { data: cands = [] } = useQuery<any[]>({ queryKey: ['a-cand', id, q], queryFn: () => api(`/admin/recovery/${id}/candidates?name=${encodeURIComponent(q!)}`), enabled: q !== null })
  const inv = () => qc.invalidateQueries({ queryKey: ['a-rec'] })
  const preview = useMutation({ mutationFn: (c: any) => api(`/admin/recovery/${id}/preview?member_id=${c.member_id}`).then(d => ({ who: c.member_id, rows: d.transactions })), onSuccess: setPv, onError })
  const merge = useMutation({ mutationFn: (m: string) => api(`/admin/recovery/${id}/merge`, 'POST', { candidate_member_id: m }), onSuccess: () => { setPv(null); inv() }, onError })
  const reject = useMutation({ mutationFn: () => api(`/admin/recovery/${id}/reject`, 'POST', {}), onSuccess: inv, onError })
  if (error) return <main><Err e={error} /></main>
  if (!r) return <main>読み込み中…</main>
  const c = r.claim, pending = r.status === 'pending'
  return (
    <main style={{ maxWidth: 980 }}><Link to="/admin/recovery">‹ 一覧</Link><h1>引き継ぎ申請</h1>
      <div className="panel"><p><b>{r.new_name}</b> <span className="mute">{RS[r.status]}・申請 {fmt(r.created_at)}・新しい家計簿の作成 {fmt(r.new_since)}</span></p>
        <p>以前の表示名: {c.prev_name}</p><p>作成時期: {c.period || '—'}</p><p style={{ whiteSpace: 'pre-wrap' }}>直近の明細:{'\n'}{c.recent}</p><p style={{ whiteSpace: 'pre-wrap' }}>そのほか: {c.other || '—'}</p>
        <Link className="btn sub" to={'/admin/inquiries/' + r.inquiry_id}>スレッドで追加の質問をする</Link></div>
      {pending && <>
        <h2>旧家計簿の候補</h2>
        <div className="row"><input placeholder="旧オーナーの表示名" value={name} onChange={e => setName(e.target.value)} /><button onClick={() => setQ(name)}>検索</button></div>
        {cands.map(k => <div className="item" key={k.member_id}>
          <div><b>{k.name}</b><div className="mute">家計簿の作成 {fmt(k.ledger_created)}・最終操作 {fmt(k.last_op)}・メンバー {k.member_count}人</div></div>
          <button className="sub sm" onClick={() => preview.mutate(k)}>直近100件を見る</button></div>)}
        {pv && <div className="panel"><p className="mute">この閲覧は監査ログに記録されます。</p>
          <div className="scroll"><table><thead><tr><th>日付</th><th>カテゴリ</th><th>金額</th><th>備考</th></tr></thead>
            <tbody>{pv.rows.map((t, i) => <tr key={i}><td>{t.date}</td><td>{t.category}</td><td>{yen(t.amount)}</td><td style={{ textAlign: 'left' }}>{t.memo}</td></tr>)}</tbody></table></div>
          <button onClick={() => ask('本人と判断し、新しい家計簿を旧家計簿に統合します。元に戻せません。', { ok: '統合する', danger: true }).then(ok => ok && merge.mutate(pv.who))}>統合する</button></div>}
        <div className="row"><button className="danger" onClick={() => ask('この申請を却下しますか?(申請者にお知らせします)', { ok: '却下', danger: true }).then(ok => ok && reject.mutate())}>却下する</button></div></>}
    </main>)
}
