import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError } from './api'
import { useMe } from './hooks'

// ログインID・パスワード(自分で決めて、コードの代わりにログインできる)
export default function CredentialsPanel() {
  const me = useMe().data!, qc = useQueryClient()
  const [loginId, setLoginId] = useState(me.login_id || ''), [cur, setCur] = useState(''), [pw, setPw] = useState('')
  useEffect(() => setLoginId(me.login_id || ''), [me.login_id])
  const save = useMutation({
    mutationFn: () => api('/me/credentials', 'PUT', { login_id: loginId, current_password: cur || undefined, password: pw || undefined }),
    onSuccess: () => { setCur(''); setPw(''); qc.invalidateQueries({ queryKey: ['me'] }); alert('保存しました') }, onError,
  })
  return (
    <form className="panel" onSubmit={e => { e.preventDefault(); save.mutate() }}><b>ログインID・パスワード</b>
      <p className="mute">{me.has_password ? 'コードを使わなくても、IDとパスワードでログインできます。' : '設定すると、コードを使わなくても、IDとパスワードでログインできます。'}</p>
      <label className="field">ログインID(英数字と . _ - の4〜32文字)<input autoComplete="username" value={loginId} onChange={e => setLoginId(e.target.value)} /></label>
      {me.has_password && <label className="field">現在のパスワード<input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></label>}
      <label className="field">{me.has_password ? '新しいパスワード(変更するときだけ。8文字以上)' : 'パスワード(8文字以上)'}<input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
      <button disabled={save.isPending || loginId.length < 4 || (!me.has_password && pw.length < 8) || (me.has_password && !cur)}>保存</button>
      {me.has_password && <p className="mute">パスワードを変更すると、他の端末はログアウトされます。</p>}
    </form>)
}
