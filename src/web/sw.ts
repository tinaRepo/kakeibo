/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { runSync } from './offline/sync'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// 画面(HTML/JS/CSS)は端末にキャッシュ → オフラインでも起動できる。API・管理者画面は対象外
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/admin/] }))
registerRoute(({ url }) => /^\/api\/receipts\/[0-9a-f-]+$/.test(url.pathname),
  new CacheFirst({ cacheName: 'receipts', plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })] }))
self.addEventListener('message', e => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting() })

// Web Push: 本文に家計簿の内容(金額など)は含まれない
self.addEventListener('push', e => {
  let d: any = { title: '家計簿', body: '新しいお知らせがあります', url: '/' }
  try { if (e.data) d = { ...d, ...e.data.json() } } catch { /* 既定の文言 */ }
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, tag: d.tag, icon: '/icon.svg', data: { url: d.url } }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil((async () => {
    const w = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))[0] as WindowClient | undefined
    if (w) { await w.focus(); await w.navigate(url) } else await self.clients.openWindow(url)
  })())
})

// Background Sync: 送信待ちを、アプリが閉じていても送る。失敗したら例外にして、ブラウザに再試行させる
;(self as any).addEventListener('sync', (e: any) => {
  if (e.tag !== 'kakeibo-sync') return
  e.waitUntil(runSync().then(async ok => {
    for (const c of await self.clients.matchAll()) c.postMessage({ type: 'synced' })
    if (!ok) throw new Error('retry')
  }))
})
