import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { api, onError } from '../api'
import { KIND, STATUS, Thread, fmt } from '../Thread'
import { Announcements, RecoveryDetail, RecoveryList } from './Admin2'
import { useTurnstile } from '../Turnstile'

const Err = ({ e }: { e: unknown }) => (e ? <p className="mute">{(e as Error).message}(Cloudflare Accessでログインしているか確認してください)</p> : null)

function AdminLogin({ st, onDone }: { st: any; onDone: () => void }) {
  const ts = useTurnstile(), [pw, setPw] = useState(''), [code, setCode] = useState('')
  const login = useMutation({ mutationFn: () => api('/admin-auth/login', 'POST', { password: pw, code, turnstile: ts.token }), onSuccess: onDone, onError: (e: Error) => { ts.reset(); setCode(''); onError(e) } })
  return (
    <section className="tile"><div className="tile-in narrow center"><p className="hero" style={{ fontSize: 34 }}>管理者ログイン</p>
      {!st.password ? <p className="mute" style={{ textAlign: 'left' }}>管理者の認証が設定されていません。<code>npm run admin:setup</code> で管理者のパスワードを作り、Secrets に登録してください(docs/admin-auth.md)。{st.access ? 'Cloudflare Access のログインを経由して開く方法も使えます。' : ''}</p> :
        <form onSubmit={e => { e.preventDefault(); if (!login.isPending && ts.ok && pw) login.mutate() }}>
          <div className="row" style={{ justifyContent: 'center' }}><input type="password" aria-label="管理者パスワード" placeholder="管理者パスワード" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          {st.totp && <div className="row" style={{ justifyContent: 'center' }}><input aria-label="確認コード" placeholder="確認コード(6桁)" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></div>}
          {ts.el}
          <button disabled={login.isPending || !ts.ok || !pw || (st.totp && code.length !== 6)}>ログイン</button></form>}
    </div></section>)
}

export default function Admin() {
  const qc = useQueryClient()
  const { data: st, refetch } = useQuery<any>({ queryKey: ['a-auth'], queryFn: () => api('/admin-auth/status') })
  const out = useMutation({ mutationFn: () => api('/admin-auth/logout', 'POST', {}), onSuccess: () => { qc.removeQueries({ queryKey: ['a-inq'] }); refetch() } })
  if (!st) return <main>読み込み中…</main>
  if (!st.authed) return <><header className="gnav"><span className="brand">家計簿 管理</span><span /></header><AdminLogin st={st} onDone={() => refetch()} /></>
  const tabs: [string, string][] = [['/admin', '問い合わせ'], ['/admin/recovery', '復旧申請'], ['/admin/announcements', 'お知らせ'], ['/admin/members', 'メンバー検索'], ['/admin/stats', '統計']]
  return (<>
    <header className="gnav"><span className="brand">家計簿 管理</span><span>管理者{st.session && <button onClick={() => out.mutate()}>ログアウト</button>}</span></header>
    <nav className="snav">{tabs.map(([to, l]) => <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => (isActive ? 'on' : '')}>{l}</NavLink>)}</nav>
    <Routes>
      <Route path="/admin" element={<Inquiries />} /><Route path="/admin/inquiries/:id" element={<InquiryDetail />} />
      <Route path="/admin/recovery" element={<RecoveryList />} /><Route path="/admin/recovery/:id" element={<RecoveryDetail />} /><Route path="/admin/announcements" element={<Announcements />} />
      <Route path="/admin/members" element={<Members />} /><Route path="/admin/stats" element={<Stats />} />
    </Routes>
  </>)
}

function Inquiries() {
  const [st, setSt] = useState('')
  const { data = [], error } = useQuery<any[]>({ queryKey: ['a-inq', st], queryFn: () => api('/admin/inquiries' + (st ? '?status=' + st : '')) })
  return (
    <main><h1>問い合わせ</h1>
      <div className="row"><select aria-label="状態" value={st} onChange={e => setSt(e.target.value)}><option value="">すべて</option>
        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <Err e={error} />{!error && data.length === 0 && <p className="mute">該当なし</p>}
      {data.map(i => <Link key={i.id} to={'/admin/inquiries/' + i.id} style={{ color: 'inherit', textDecoration: 'none' }}>
        <div className="item"><div style={{ minWidth: 0 }}><div><b>{KIND[i.kind]}</b> <span className="mute">{i.member_name || '(未設定)'}({i.member_role === 'owner' ? 'オーナー' : 'ユーザー'})・{STATUS[i.status]}・{fmt(i.last_at)}</span></div>
          <div className="mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.last_sender === 'admin' ? '返信: ' : ''}{i.last_body}</div></div></div></Link>)}
    </main>)
}

function InquiryDetail() {
  const { id } = useParams(), qc = useQueryClient(), [text, setText] = useState('')
  const { data, error } = useQuery<any>({ queryKey: ['a-inq', 'one', id], queryFn: () => api('/admin/inquiries/' + id) })
  const inv = () => qc.invalidateQueries({ queryKey: ['a-inq'] })
  const reply = useMutation({ mutationFn: () => api(`/admin/inquiries/${id}/reply`, 'POST', { body: text }), onSuccess: () => { setText(''); inv() }, onError })
  const status = useMutation({ mutationFn: (s: string) => api('/admin/inquiries/' + id, 'PATCH', { status: s }), onSuccess: inv, onError })
  if (error) return <main><Err e={error} /></main>
  if (!data) return <main>読み込み中…</main>
  const i = data.inquiry
  return (
    <main><Link to="/admin">‹ 一覧</Link><h1>{KIND[i.kind]}</h1>
      <p className="mute">{i.member_name || '(未設定)'}({i.member_role === 'owner' ? 'オーナー' : 'ユーザー'})・参加 {fmt(i.member_since)}・{STATUS[i.status]}</p>
      <Thread msgs={data.messages} me="admin" />
      <label className="field">返信({text.length}/2000)<textarea maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label>
      <button disabled={reply.isPending || !text.trim()} onClick={() => reply.mutate()}>返信する</button>
      {i.status === 'closed' ? <button className="sub" onClick={() => status.mutate('open')}>再オープン</button> : <button className="sub" onClick={() => status.mutate('closed')}>完了にする</button>}
    </main>)
}

function Members() {
  const [q, setQ] = useState(''), [role, setRole] = useState('')
  const { data = [], error } = useQuery<any[]>({ queryKey: ['a-mem', q, role], queryFn: () => api(`/admin/members?q=${encodeURIComponent(q)}&role=${role}`) })
  return (
    <main style={{ maxWidth: 980 }}><h1>メンバー検索</h1>
      <div className="row"><input placeholder="表示名" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="ロール" value={role} onChange={e => setRole(e.target.value)}><option value="">すべて</option><option value="owner">オーナー</option><option value="user">ユーザー</option></select></div>
      <Err e={error} />
      <div className="scroll"><table><thead><tr><th>表示名</th><th>ロール</th><th>最終操作</th><th>最終アクセス(参考)</th><th>参加日</th><th>明細件数</th></tr></thead>
        <tbody>{data.map(m => <tr key={m.id}><td>{m.name || '(未参加)'}</td><td>{m.role === 'owner' ? 'オーナー' : 'ユーザー'}</td><td>{fmt(m.last_op)}</td><td>{fmt(m.last_access)}</td><td>{fmt(m.created_at)}</td><td>{m.tx_count}</td></tr>)}</tbody></table></div>
      <p className="mute">最終操作は、そのメンバーが入力した明細の更新日時の最大値です(簡易的な指標で、操作履歴ではありません。オーナーが編集した分も作成者の操作として数えます)。最終アクセスは1日に1回までの更新です。金額や明細の内容は表示しません。</p>
    </main>)
}

function Stats() {
  const { data, error } = useQuery<any>({ queryKey: ['a-stats'], queryFn: () => api('/admin/stats') })
  return (
    <main><h1>統計</h1><Err e={error} />
      {data && <div className="panel"><p>家計簿 <b>{data.ledgers}</b> 冊</p><p>メンバー <b>{data.members}</b> 人</p><p>画像の使用量 <b>{(data.receipt_bytes / 1024 / 1024).toFixed(1)} MB</b></p></div>}
    </main>)
}
