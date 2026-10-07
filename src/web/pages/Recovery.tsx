import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, onError } from '../api'
import { useMe } from '../hooks'
import { useTurnstile } from '../Turnstile'

export default function Recovery() {
  const me = useMe().data!, nav = useNavigate(), ts = useTurnstile()
  const [f, setF] = useState({ prev_name: '', period: '', recent: '', other: '' })
  const send = useMutation({
    mutationFn: () => api('/recovery', 'POST', { ...f, turnstile: ts.token }),
    onSuccess: (r: any) => nav('/inquiries/' + r.id), onError: (e: Error) => { ts.reset(); onError(e) },
  })
  if (me.role !== 'owner') return <Navigate to="/settings" replace />
  return (
    <main><Link to="/settings">‹ 設定</Link><h1>以前の家計簿の引き継ぎを申請</h1>
      <p className="mute">管理者が内容を確認して、以前の家計簿へ統合します。確実な復旧は保証できません。確認が取れるまでの間も、いまの家計簿を使えます。</p>
      <label className="field">以前の表示名<input maxLength={30} value={f.prev_name} onChange={e => setF({ ...f, prev_name: e.target.value })} /></label>
      <label className="field">家計簿を作ったおおよその時期<input maxLength={50} placeholder="例: 今年の春ごろ" value={f.period} onChange={e => setF({ ...f, period: e.target.value })} /></label>
      <label className="field">覚えている直近の明細(日付・金額・カテゴリ・備考など。複数件)<textarea maxLength={1500} value={f.recent} onChange={e => setF({ ...f, recent: e.target.value })} /></label>
      <label className="field">そのほか本人だと分かる情報(以前のユーザーの名前など)<textarea maxLength={500} style={{ minHeight: 80 }} value={f.other} onChange={e => setF({ ...f, other: e.target.value })} /></label>
      {ts.el}
      <button disabled={send.isPending || !ts.ok || !f.prev_name.trim() || !f.recent.trim()} onClick={() => send.mutate()}>申請する</button>
    </main>)
}
