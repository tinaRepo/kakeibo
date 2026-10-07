import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError } from '../api'
import { clearLocal } from '../offline/db'
import { useTurnstile } from '../Turnstile'
import Scanner from '../Scanner'

type Mode = 'login' | 'new' | 'join' | 'lost'
const FLAG = 'kakeibo.account'

export default function Login() {
  const qc = useQueryClient(), ts = useTurnstile()
  const [mode, setMode] = useState<Mode>(localStorage.getItem(FLAG) ? 'login' : 'new')
  const [name, setName] = useState(''), [loginId, setLoginId] = useState(''), [pw, setPw] = useState(''), [code, setCode] = useState('')
  const [scan, setScan] = useState(false), [issued, setIssued] = useState('')
  const needToken = mode !== 'join' || !/^[DH]-/i.test(code.trim())
  const register = mode === 'new' || mode === 'lost'
  const done = () => { localStorage.setItem(FLAG, '1'); return clearLocal().then(() => qc.resetQueries()) }
  const go = useMutation({
    mutationFn: () => (mode === 'login' ? api('/login', 'POST', { login_id: loginId, password: pw, turnstile: ts.token })
      : mode === 'join' ? api('/join', 'POST', { code, name, turnstile: ts.token })
      : api('/ledgers', 'POST', { name, login_id: loginId, password: pw, turnstile: ts.token })),
    // 「コードを紛失した」場合だけ、新しいコードを必ず控えてもらう(引き継ぎ後のオーナーコードになる)
    onSuccess: (r: any) => { ts.reset(); mode === 'lost' ? setIssued(r.code) : done() },
    onError: (e: Error) => { ts.reset(); onError(e) },
  })
  const valid = mode === 'login' ? !!loginId && !!pw : mode === 'join' ? !!code.trim() : !!name.trim() && /^[A-Za-z0-9._-]{4,32}$/.test(loginId) && pw.length >= 8
  if (issued) return (
    <section className="tile"><div className="tile-in narrow"><h1>新しいオーナーコード</h1>
      <p>引き継ぎが完了すると、このコードが以前の家計簿のオーナーコードになります。再表示できないので、必ず控えてください。他人には教えないでください。</p>
      <code className="code">{issued}</code>
      <button className="sub" onClick={() => navigator.clipboard.writeText(issued)}>コピー</button><button onClick={done}>控えました</button>
      <p className="mute">このあと、設定 → 「以前の家計簿の引き継ぎを申請」から申請してください。</p></div></section>)
  return (
    <section className="tile"><div className="tile-in narrow center">
      <p className="hero">家計簿</p><p className="lead">支出も収入も、ひと目で。</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {([['login', 'ログイン'], ['new', '新しく作る'], ['join', 'コードで参加'], ['lost', 'コードを紛失']] as [Mode, string][]).map(([m, l]) =>
          <button key={m} className={mode === m ? '' : 'sub'} onClick={() => setMode(m)}>{l}</button>)}</div>
      {mode === 'lost' && <p className="mute" style={{ textAlign: 'left' }}>オーナーコードを失くした場合は、新しい家計簿を作り、あとから「以前の家計簿の引き継ぎ」を申請してください。管理者が内容を確認して統合します(確実な復旧は保証できません)。確認が取れるまでの間も、新しい家計簿を使えます。</p>}
      <form onSubmit={e => { e.preventDefault(); if (valid && !go.isPending && (!needToken || ts.ok)) go.mutate() }}>
        {(register || mode === 'join') && <div className="row" style={{ justifyContent: 'center' }}><input aria-label="表示名" placeholder={mode === 'join' ? '表示名(ユーザー参加のとき)' : '表示名'} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)} /></div>}
        {(register || mode === 'login') && <>
          <div className="row" style={{ justifyContent: 'center' }}><input aria-label="ログインID" placeholder={register ? 'ログインID(英数字と . _ - の4〜32文字)' : 'ログインID'} autoComplete="username" autoCapitalize="none" value={loginId} onChange={e => setLoginId(e.target.value)} /></div>
          <div className="row" style={{ justifyContent: 'center' }}><input aria-label="パスワード" type="password" placeholder={register ? 'パスワード(8文字以上)' : 'パスワード'} autoComplete={register ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} /></div></>}
        {mode === 'join' && <div className="row" style={{ justifyContent: 'center' }}><input aria-label="コード" style={{ width: '100%' }} placeholder="O-… / U-… / D-…" value={code} onChange={e => setCode(e.target.value)} />
          <span className="mute">{code.startsWith('O-') ? 'オーナーとして復元します' : code.startsWith('U-') ? 'ユーザーとして参加します' : code.startsWith('D-') ? '端末追加コードでログインします' : ''}</span>
          <button type="button" className="sub" onClick={() => setScan(true)}>QRコードを読み取る</button></div>}
        {needToken && ts.el}
        <button disabled={go.isPending || !valid || (needToken && !ts.ok)}>{mode === 'login' ? 'ログイン' : mode === 'join' ? '参加する' : '家計簿を作成'}</button>
      </form>
      {scan && <Scanner onCode={c => { setCode(c.trim()); setScan(false) }} onClose={() => setScan(false)} />}
      <p className="mute"><a href="/terms">規約・プライバシー</a></p>
    </div></section>)
}
