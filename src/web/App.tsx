import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError } from './api'
import { useMe, useOnline, usePending, useSyncErrors } from './hooks'
import { useConfirm } from './ui'
import { clearLocal, db } from './offline/db'
import { runSync } from './offline/sync'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Transactions from './pages/Transactions'
import Subscriptions from './pages/Subscriptions'
import Budget from './pages/Budget'
import Settings from './pages/Settings'
import Inquiries from './pages/Inquiries'
import Announcements from './pages/Announcements'
import Recovery from './pages/Recovery'
import Terms from './pages/Terms'
import Admin from './admin/Admin'
import Members from './pages/Members'

const HANDOFF = new URLSearchParams(location.search).get('handoff') // ホーム画面アプリの初回起動で受け取る引き継ぎトークン

function MemberApp() {
  const me = useMe(), qc = useQueryClient()
  const logout = useMutation({ mutationFn: () => api('/logout', 'POST', {}), onSuccess: () => clearLocal().then(() => qc.resetQueries()), onError })
  const ask = useConfirm()
  const [refreshing, setRefreshing] = useState(false)
  // 更新: 同期 → 新しいバージョンの確認 → 再読み込み(開いていたタブはURLで復元される)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.race([runSync(qc), new Promise(r => setTimeout(r, 5000))])
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update(); reg?.waiting?.postMessage({ type: 'SKIP_WAITING' })
    } catch { /* 失敗しても再読み込みする */ } finally { location.reload() }
  }
  const unread = useQuery<{ replies: number; announcements: number }>({ queryKey: ['unread'], queryFn: () => api('/unread-count'), refetchInterval: 60_000, retry: false, enabled: !!me.data }).data
  const tried = useRef(false)
  useEffect(() => { // 引き継ぎトークンでログイン(使用後はURLから消す)
    if (!HANDOFF || me.isLoading || tried.current) return
    tried.current = true
    const strip = () => history.replaceState(history.state, '', location.pathname + location.hash)
    if (me.data) return strip()
    api('/join', 'POST', { code: HANDOFF }).then(() => clearLocal()).then(() => qc.resetQueries()).catch(() => {}).finally(strip)
  }, [me.isLoading, me.data])
  const onLogout = async () => {
    const n = (await db.outbox.count()) + (await db.images.count())
    if (n > 0 && !(await ask(`未同期の入力が${n}件あります。ログアウトすると失われます。`, { ok: 'ログアウト', danger: true }))) return
    // この端末への通知登録を解除する(共用の端末で、次に使う人へ通知が届かないように)
    try {
      const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription()
      if (sub) { await api('/push/subscribe', 'DELETE', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}) }
    } catch { /* 通知に未対応 */ }
    logout.mutate()
  }
  useEffect(() => { // 起動時・オンライン復帰時・画面に戻ったとき・定期的に同期
    if (!me.data) return
    const go = () => { runSync(qc) }
    const vis = () => document.visibilityState === 'visible' && go()
    go(); addEventListener('online', go); document.addEventListener('visibilitychange', vis)
    const t = setInterval(go, 60_000)
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'synced') { qc.invalidateQueries({ queryKey: ['tx'] }); qc.invalidateQueries({ queryKey: ['summary'] }) } }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => { removeEventListener('online', go); document.removeEventListener('visibilitychange', vis); clearInterval(t); navigator.serviceWorker?.removeEventListener('message', onMsg) }
  }, [me.data?.id])
  if (me.isLoading) return <main>読み込み中…</main>
  if (me.isError || !me.data) return <Login />
  const tabs: [string, string][] = [['/', '集計'], ['/detail', '明細'], ['/subs', 'サブスク'], ['/budget', '予算'], ['/announcements', 'お知らせ'], ['/inquiries', '問い合わせ'], ['/settings', '設定']]
  return (<>
    <header className="gnav"><span className="brand">家計簿</span>
      <span><button className="refresh" disabled={refreshing} onClick={refresh} aria-label="最新の状態に更新">{refreshing ? '更新中…' : '↻ 更新'}</button>{me.data.name}({me.data.role === 'owner' ? 'オーナー' : 'ユーザー'})<button onClick={onLogout}>ログアウト</button></span></header>
    <nav className="snav">{tabs.map(([to, l]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'on' : '')}>{l}{to === '/inquiries' && !!unread?.replies && <span className="badge">{unread.replies}</span>}{to === '/announcements' && !!unread?.announcements && <span className="badge">{unread.announcements}</span>}</NavLink>)}</nav>
    <SyncBar />
    <Routes>
      <Route path="/" element={<Dashboard />} /><Route path="/detail" element={<Transactions />} /><Route path="/tx" element={<Navigate to="/detail" replace />} />
      <Route path="/subs" element={<Subscriptions />} /><Route path="/budget" element={<Budget />} />
      <Route path="/announcements" element={<Announcements />} /><Route path="/recovery" element={<Recovery />} />
      <Route path="/inquiries" element={<Inquiries />} /><Route path="/inquiries/:id" element={<Inquiries />} />
      <Route path="/settings" element={<Settings />} /><Route path="/settings/members" element={<Members />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>)
}

function SyncBar() {
  const online = useOnline(), pending = usePending(), errors = useSyncErrors().length
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone
  if (online && !pending && !errors) return null
  return (
    <div className="syncbar" role="status">
      {!online && <span>オフラインです。入力は端末に保存され、接続が戻ると自動で送信されます。</span>}
      {pending > 0 && <span> 未同期 {pending}件。</span>}
      {errors > 0 && <Link to="/settings">同期エラー {errors}件(確認する)</Link>}
      {pending > 0 && !standalone && <span> 未同期の入力が消えるのを防ぐため、ホーム画面に追加したアプリでの利用をおすすめします。</span>}
    </div>)
}

// /admin は利用者のログインとは別(Cloudflare Accessで保護)
export default function App() {
  const p = location.pathname
  return p.startsWith('/admin') ? <Admin /> : p === '/terms' ? <Terms /> : <MemberApp />
}
