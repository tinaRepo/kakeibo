import { useEffect, useRef, useState } from 'react'
import { useConfig } from './hooks'

declare global { interface Window { turnstile?: any } }

function Widget({ onToken }: { onToken: (t: string) => void }) {
  const { data: cfg } = useConfig(), ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!cfg?.turnstileSiteKey) return
    let id: any, dead = false
    const mount = () => { if (!dead && ref.current) id = window.turnstile.render(ref.current, { sitekey: cfg.turnstileSiteKey, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') }) }
    if (window.turnstile) mount()
    else { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = mount; document.head.appendChild(s) }
    return () => { dead = true; try { window.turnstile?.remove(id) } catch { /* 既に破棄済み */ } }
  }, [cfg?.turnstileSiteKey])
  return <div ref={ref} style={{ margin: '12px 0' }} />
}

// サイトキー未設定(ローカル開発)なら何も表示せず、送信も止めない
export function useTurnstile() {
  const { data: cfg } = useConfig(), [token, setToken] = useState(''), [n, setN] = useState(0)
  return { token, ok: !cfg?.turnstileSiteKey || !!token, el: <Widget key={n} onToken={setToken} />, reset: () => { setToken(''); setN(x => x + 1) } }
}
