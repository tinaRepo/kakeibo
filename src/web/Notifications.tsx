import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onError } from './api'
import { useConfig } from './hooks'

const key = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

// 設定画面: プッシュ通知(返信・お知らせ・予算超過をそれぞれON/OFF)
export default function Notifications() {
  const qc = useQueryClient(), { data: cfg } = useConfig(), [endpoint, setEndpoint] = useState('')
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  useEffect(() => { if (supported) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => setEndpoint(s?.endpoint || '')) }, [])
  const { data: n } = useQuery<any>({ queryKey: ['notif', endpoint], queryFn: () => api('/me/notifications?endpoint=' + encodeURIComponent(endpoint)) })
  const inv = () => qc.invalidateQueries({ queryKey: ['notif'] })
  const set = useMutation({ mutationFn: (b: any) => api('/me/notifications', 'PUT', { endpoint, ...b }), onSuccess: inv, onError })
  const enable = useMutation({
    mutationFn: async () => {
      if (!cfg?.vapidPublicKey) throw new Error('通知の設定がサーバーに未登録です')
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('通知が許可されませんでした')
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(cfg.vapidPublicKey) }))
      const j = sub.toJSON()
      await api('/push/subscribe', 'POST', { endpoint: j.endpoint, keys: j.keys })
      setEndpoint(j.endpoint!)
    }, onSuccess: inv, onError,
  })
  const disable = useMutation({
    mutationFn: async () => { const s = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); await api('/push/subscribe', 'DELETE', { endpoint: s?.endpoint || endpoint }); await s?.unsubscribe(); setEndpoint('') },
    onSuccess: inv, onError,
  })
  const toggle = (k: string, label: string, disabled = false) => (
    <label className="row"><input type="checkbox" disabled={disabled} checked={!!n?.[k]} onChange={e => set.mutate({ [k]: e.target.checked })} />{label}</label>)
  return (
    <div className="panel"><b>通知</b>
      {!supported ? <p className="mute">この環境ではプッシュ通知を使えません。iPhone / iPad では、ホーム画面に追加したアプリでのみ使えます(iOS 16.4以降)。代わりに、アプリ内のバッジでお知らせします。</p> : <>
        <div className="row">{n?.subscribed ? <button className="sub" onClick={() => disable.mutate()}>この端末の通知を解除</button> : <button disabled={enable.isPending} onClick={() => enable.mutate()}>この端末で通知を受け取る</button>}</div>
        {toggle('notify_reply', '問い合わせへの返信(この端末)', !n?.subscribed)}
        {toggle('notify_announce', 'お知らせ(この端末)', !n?.subscribed)}
        {toggle('notify_budget', '予算の超過(80%到達・100%超過。この家計簿の通知をオンにしたあなたの端末へ)')}
        <p className="mute">通知の本文に金額などは含まれません。</p></>}
    </div>)
}
