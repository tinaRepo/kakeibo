import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, onError } from '../api'
import { Modal } from '../ui'
import { KIND, STATUS, Thread, fmt } from '../Thread'
import { useTurnstile } from '../Turnstile'

export default function Inquiries() {
  const { id } = useParams()
  return id ? <Detail id={id} /> : <List />
}

function List() {
  const qc = useQueryClient(), nav = useNavigate(), [f, setF] = useState<any>(null), ts = useTurnstile()
  const { data = [] } = useQuery<any[]>({ queryKey: ['inq'], queryFn: () => api('/inquiries') })
  const send = useMutation({
    mutationFn: (f: any) => api('/inquiries', 'POST', { ...f, turnstile: ts.token }),
    onSuccess: (r: any) => { setF(null); ts.reset(); qc.invalidateQueries({ queryKey: ['inq'] }); nav('/inquiries/' + r.id) }, onError: (e: Error) => { ts.reset(); onError(e) },
  })
  return (
    <main><h1>問い合わせ</h1>
      <button onClick={() => setF({ kind: 'question', body: '' })}>＋ 新しく送る</button>
      <p className="mute">自分が送ったものと、その返信だけが表示されます。</p>
      {data.length === 0 && <p className="mute">まだありません。</p>}
      {data.map(i => <Link key={i.id} to={'/inquiries/' + i.id} style={{ color: 'inherit', textDecoration: 'none' }}>
        <div className="item"><div style={{ minWidth: 0 }}><div><b>{KIND[i.kind]}</b> <span className="mute">{STATUS[i.status]}・{fmt(i.last_at)}</span></div>
          <div className="mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.last_body}</div></div>
          {i.unread > 0 && <span className="badge">新着</span>}</div></Link>)}
      {f && <Modal title="問い合わせを送る" onClose={() => setF(null)}>
        <label className="field">種別<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
          <option value="question">問い合わせ</option><option value="request">要望</option><option value="bug">不具合</option></select></label>
        <label className="field">内容({f.body.length}/2000)<textarea maxLength={2000} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></label>
        {ts.el}<p className="mute">メールアドレスは使いません。返信はこの画面とお知らせでお届けします。</p>
        <div className="row end"><button className="sub" onClick={() => setF(null)}>キャンセル</button>
          <button disabled={send.isPending || !ts.ok || !f.body.trim()} onClick={() => send.mutate(f)}>送信</button></div>
      </Modal>}
    </main>)
}

function Detail({ id }: { id: string }) {
  const qc = useQueryClient(), [text, setText] = useState('')
  const { data } = useQuery<any>({ queryKey: ['inq', id], queryFn: () => api('/inquiries/' + id), refetchInterval: 30_000 })
  useEffect(() => { if (data) qc.invalidateQueries({ queryKey: ['unread'] }) }, [data]) // 開くと既読になる
  const send = useMutation({
    mutationFn: () => api(`/inquiries/${id}/messages`, 'POST', { body: text }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['inq'] }) }, onError,
  })
  if (!data) return <main>読み込み中…</main>
  return (
    <main><Link to="/inquiries">‹ 問い合わせ</Link>
      <h1>{KIND[data.inquiry.kind]}</h1><p className="mute">{STATUS[data.inquiry.status]}・{fmt(data.inquiry.created_at)}</p>
      <Thread msgs={data.messages} me="member" />
      <label className="field">追記({text.length}/2000)<textarea maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={send.isPending || !text.trim()} onClick={() => send.mutate()}>送信</button>
    </main>)
}
