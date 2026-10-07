import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { api, onError } from './api'
import { db } from './offline/db'
import { runSync } from './offline/sync'

// 設定画面: ホーム画面アプリへのログイン引き継ぎ(自動引き継ぎ → 端末追加コード)
export default function HandoffPanel() {
  const qc = useQueryClient()
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
  const [active, setActive] = useState(false), prev = useRef('/')
  const [dev, setDev] = useState<{ code: string; qr: string; exp: string } | null>(null)
  const prepare = useMutation({
    mutationFn: async () => {
      if (!navigator.onLine) throw new Error('オンラインのときに行ってください')
      await runSync(qc) // 送信待ちは端末ごとに別なので、先に同期する
      const n = (await db.outbox.count()) + (await db.images.count())
      if (n > 0) throw new Error(`未同期の入力が${n}件あります。同期が終わってから、もう一度お試しください`)
      return api('/me/device-link', 'POST', { purpose: 'handoff' })
    },
    onSuccess: (r: any) => {
      prev.current = location.pathname + location.search
      history.replaceState(history.state, '', '/?handoff=' + encodeURIComponent(r.code)) // この状態で「ホーム画面に追加」する
      setActive(true)
    }, onError,
  })
  const finish = () => { history.replaceState(history.state, '', prev.current); setActive(false) }
  const issue = useMutation({
    mutationFn: () => api('/me/device-link', 'POST', { purpose: 'device' }),
    onSuccess: async (r: any) => setDev({ code: r.code, qr: await QRCode.toDataURL(r.code, { margin: 1, width: 220 }), exp: r.expires_at }), onError,
  })
  return (
    <div className="panel"><b>ホーム画面に追加・別の端末で使う</b>
      {standalone ? <p className="mute">いまホーム画面のアプリとして開いています。</p> : !active ? <>
        <p className="mute">iPhone / iPadでは、Safariとホーム画面のアプリでログインが別になります。先に準備をしておくと、アプリ側でもそのまま使えます。</p>
        <button disabled={prepare.isPending} onClick={() => prepare.mutate()}>ホーム画面に追加する準備</button></> : <>
        <p>準備ができました。このまま、Safariの共有ボタンから「ホーム画面に追加」を押してください。追加後にアプリを開くと、自動でログインされます。</p>
        <p className="mute">うまくログインできないときは、下の「端末追加コード」を使ってください。引き継ぎ用のURLは24時間・1回限り有効です。</p>
        <button className="sub" onClick={finish}>追加した(閉じる)</button></>}
      <div className="row"><button className="sub" disabled={issue.isPending} onClick={() => issue.mutate()}>端末追加コードを発行</button></div>
      {dev && <><img src={dev.qr} alt="端末追加コードのQRコード" width={220} height={220} style={{ borderRadius: 11 }} />
        <code className="code">{dev.code}</code>
        <p className="mute">{new Date(dev.exp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} まで有効・1回限り。追加したい端末の「コードで参加・復元」に入力するか、QRコードを読み取ってください。</p></>}
    </div>)
}
