import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { api } from './api'
import { cached, db } from './offline/db'
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => cached('me', () => api('/me')), retry: false, staleTime: Infinity })
export const useCats = () => useQuery<any[]>({ queryKey: ['categories'], queryFn: () => cached('cats', () => api('/categories')), staleTime: 60_000 })
export function useOnline() {
  const [o, setO] = useState(navigator.onLine)
  useEffect(() => { const a = () => setO(true), b = () => setO(false); addEventListener('online', a); addEventListener('offline', b); return () => { removeEventListener('online', a); removeEventListener('offline', b) } }, [])
  return o
}
export const usePending = () => useLiveQuery(async () => (await db.outbox.count()) + (await db.images.count()), [], 0)
export const useSyncErrors = () => useLiveQuery(() => db.errors.toArray(), [], [] as any[])
export const useConfig = () => useQuery<{ turnstileSiteKey: string; vapidPublicKey: string }>({ queryKey: ['config'], queryFn: () => api('/config'), staleTime: Infinity })
