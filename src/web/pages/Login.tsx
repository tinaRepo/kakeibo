import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError } from '../api'
import { clearLocal } from '../offline/db'
import { useTurnstile } from '../Turnstile'
import Scanner from '../Scanner'
import { Seg } from '../ui'

type Tab = 'owner' | 'member' | 'new' | 'lost'
type How = 'id' | 'code'
const FLAG = 'kakeibo.account'

export default function Login() {
  const qc = useQueryClient(), ts = useTurnstile(), hasAccount = !!localStorage.getItem(FLAG)
  const [tab, setTabRaw] = useState<Tab>(hasAccount ? 'owner' : 'new'), [how, setHow] = useState<How>('id')
  const [name, setName] = useState(''), [loginId, setLoginId] = useState(''), [pw, setPw] = useState(''), [code, setCode] = useState('')
  const [scan, setScan] = useState(false), [issued, setIssued] = useState('')
  const [after, setAfter] = useState<null | { needs: boolean; loginId: string | null }>(null) // コードで入ったあと: IDとパスワードの作成 / 案内
  const setTab = (t: Tab) => { setTabRaw(t); setHow(t === 'member' && !hasAccount ? 'code' : 'id') }
  const register = tab === 'new' || tab === 'lost', byId = !register && how === 'id', byCode = !register && how === 'code'
  const needToken = !byCode || !/^[DH]-/i.test(code.trim())
  const done = () => { localStorage.setItem(FLAG, '1'); return clearLocal().then(() => qc.resetQueries()) }
  const codeErr = !byCode || !code ? '' : tab === 'owner' && /^U-/i.test(code) ? 'これはメンバー用のコードです。「メンバーで参加」から入力してください' : tab === 'member' && /^O-/i.test(code) ? 'これはオーナーコードです。「オーナーでログイン」から入力してください' : ''
  const go = useMutation({
    mutationFn: () => register ? api('/ledgers', 'POST', { name, login_id: loginId, password: pw, turnstile: ts.token })
      : byId ? api('/login', 'POST', { login_id: loginId, password: pw, role: tab === 'owner' ? 'owner' : 'user', turnstile: ts.token })
        : api('/join', 'POST', { code, name, turnstile: ts.token }),
    onSuccess: (r: any) => {
      ts.reset()
      if (tab === 'lost') setIssued(r.code) // 引き継ぎ後のオーナーコードになるので、必ず控えてもらう
      else if (byCode) { setLoginId(''); setPw(''); setAfter({ needs: !!r.needs_credentials, loginId: r.login_id ?? null }) }
      else done()
    },
    onError: (e: Error) => { ts.reset(); onError(e) },
  })
  const setup = useMutation({ mutationFn: () => api('/me/credentials', 'PUT', { login_id: loginId, password: pw }), onSuccess: () => done(), onError })
  const idOk = /^[A-Za-z0-9._-]{4,32}$/.test(loginId)
  const valid = register ? !!name.trim() && idOk && pw.length >= 8 : byId ? !!loginId && !!pw : !!code.trim() && !codeErr

  if (issued) return (
    <section className="tile"><div className="tile-in narrow"><h1>新しいオーナーコード</h1>
      <p>引き継ぎが完了すると、このコードが以前の家計簿のオーナーコードになります。再表示できないので、必ず控えてください。他人には教えないでください。</p>
      <code className="code">{issued}</code>
      <button className="sub" onClick={() => navigator.clipboard.writeText(issued)}>コピー</button><button onClick={done}>控えました</button>
      <p className="mute">このあと、設定 → 「以前の家計簿の引き継ぎを申請」から申請してください。</p></div></section>)

  if (after) return (
    <section className="tile"><div className="tile-in narrow">
      {after.needs ? <form onSubmit={e => { e.preventDefault(); if (idOk && pw.length >= 8 && !setup.isPending) setup.mutate() }}>
        <h1>ログインIDとパスワードを作成</h1>
        <p>次回からは、コードを入力しなくても、このIDとパスワードで入れます。IDとパスワードは、あなたのコードに1組だけ紐づきます。</p>
        <label className="field">ログインID(英数字と . _ - の4〜32文字)<input autoComplete="username" autoCapitalize="none" value={loginId} onChange={e => setLoginId(e.target.value)} /></label>
        <label className="field">パスワード(8文字以上)<input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
        <div className="row"><button disabled={setup.isPending || !idOk || pw.length < 8}>作成してはじめる</button><button type="button" className="sub" onClick={done}>あとで設定する</button></div>
        <p className="mute">「あとで」を選んでも、これまでどおりコードで入れます。設定画面からも作成できます。</p>
      </form> : <>
        <h1>ログインしました</h1>
        <p>あなたのログインIDは <b>{after.loginId}</b> です。次回からは、「{tab === 'owner' ? 'オーナーでログイン' : 'メンバーで参加'} → IDとパスワード」で入れます。</p>
        <p className="mute">パスワードが分からないときは、このコードで入り、設定画面から変更できます。</p>
        <button onClick={done}>はじめる</button></>}
    </div></section>)

  return (
    <section className="tile"><div className="tile-in narrow center">
      <p className="hero">家計簿</p><p className="lead">支出も収入も、ひと目で。</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {([['owner', 'オーナーでログイン'], ['member', 'メンバーで参加'], ['new', '新しく作る(オーナー)'], ['lost', 'コードを紛失']] as [Tab, string][]).map(([t, l]) =>
          <button key={t} className={tab === t ? '' : 'sub'} onClick={() => setTab(t)}>{l}</button>)}</div>
      {!register && <div className="row" style={{ justifyContent: 'center' }}>
        <Seg value={how} options={[['id', 'IDとパスワード'], ['code', tab === 'owner' ? 'オーナーコード' : '参加コード']] as const} onChange={setHow} /></div>}
      {tab === 'member' && byCode && <p className="mute" style={{ textAlign: 'left' }}>オーナーから受け取った参加コードを入力します。初めて入るときに、次回からコードなしで入れるよう、IDとパスワードを作成できます。</p>}
      {tab === 'lost' && <p className="mute" style={{ textAlign: 'left' }}>オーナーコードを失くした場合は、新しい家計簿を作り、あとから「以前の家計簿の引き継ぎ」を申請してください。管理者が内容を確認して統合します(確実な復旧は保証できません)。確認が取れるまでの間も、新しい家計簿を使えます。</p>}
      <form onSubmit={e => { e.preventDefault(); if (valid && !go.isPending && (!needToken || ts.ok)) go.mutate() }}>
        {(register || (tab === 'member' && byCode)) && <div className="row" style={{ justifyContent: 'center' }}><input aria-label="表示名" placeholder={register ? '表示名' : '表示名(初めて参加するとき)'} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} /></div>}
        {(register || byId) && <>
          <div className="row" style={{ justifyContent: 'center' }}><input aria-label="ログインID" placeholder={register ? 'ログインID(英数字と . _ - の4〜32文字)' : 'ログインID'} autoComplete="username" autoCapitalize="none" value={loginId} onChange={e => setLoginId(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'center' }}><input aria-label="パスワード" type="password" placeholder={register ? 'パスワード(8文字以上)' : 'パスワード'} autoComplete={register ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} /></div></>}
        {byCode && <div className="row" style={{ justifyContent: 'center' }}><input aria-label="コード" style={{ width: '100%' }} placeholder={tab === 'owner' ? 'O-…' : 'U-…(または D-…)'} value={code} onChange={e => setCode(e.target.value)} />
          {codeErr ? <span className="mute" role="alert">{codeErr}</span> : <span className="mute">{code.startsWith('D-') ? '端末追加コードでログインします' : ''}</span>}
          <button type="button" className="sub" onClick={() => setScan(true)}>QRコードを読み取る</button></div>}
        {needToken && ts.el}
        <button disabled={go.isPending || !valid || (needToken && !ts.ok)}>{register ? '家計簿を作成' : byId ? 'ログイン' : tab === 'owner' ? '復元する' : '参加する'}</button>
      </form>
      {scan && <Scanner onCode={c => { setCode(c.trim()); setScan(false) }} onClose={() => setScan(false)} />}
      <p className="mute"><a href="/terms">規約・プライバシー</a></p>
    </div></section>)
}
