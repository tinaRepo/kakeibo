import type { Env } from './env'

// 管理者ログイン(Cloudflare Accessを使えない場合の認証): パスワード + 確認コード(TOTP) + 署名つきセッションCookie
const enc = new TextEncoder()
const toB64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const hmacKey = (secret: string | Uint8Array, usage: ('sign' | 'verify')[], hash = 'SHA-256') => crypto.subtle.importKey('raw', typeof secret === 'string' ? enc.encode(secret) : secret, { name: 'HMAC', hash }, false, usage)

export async function signAdminToken(env: Env, ttlSec: number) {
  const payload = toB64u(enc.encode(JSON.stringify({ exp: Date.now() + ttlSec * 1000 })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env.ADMIN_SESSION_SECRET!, ['sign']), enc.encode(payload)))
  return `${payload}.${toB64u(sig)}`
}
export async function verifyAdminToken(env: Env, token: string) {
  try {
    if (!env.ADMIN_SESSION_SECRET || !env.ADMIN_PASSWORD_HASH) return false
    const [p, s] = token.split('.')
    if (!p || !s || !(await crypto.subtle.verify('HMAC', await hmacKey(env.ADMIN_SESSION_SECRET, ['verify']), fromB64u(s), enc.encode(p)))) return false
    return JSON.parse(new TextDecoder().decode(fromB64u(p))).exp > Date.now()
  } catch { return false }
}

const b32 = (s: string) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', out: number[] = []
  let bits = 0, val = 0
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 } }
  return new Uint8Array(out)
}
async function totpAt(secret: string, step: number) {
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, step)
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(b32(secret), ['sign'], 'SHA-1'), msg))
  const o = h[19] & 15, n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, '0')
}
// RFC 6238(6桁・30秒)。前後1つ分の時間のずれを許容し、使用済みの確認コードは再利用できない
export async function verifyTotp(env: Env, code: string) {
  if (!env.ADMIN_TOTP_SECRET || !/^\d{6}$/.test(code)) return false
  const cur = Math.floor(Date.now() / 30000)
  const last = Number((await env.DB.prepare(`SELECT v FROM system_kv WHERE k = 'admin_totp_last'`).first<any>())?.v || 0)
  for (const step of [cur - 1, cur, cur + 1]) {
    if (step > last && (await totpAt(env.ADMIN_TOTP_SECRET, step)) === code) {
      await env.DB.prepare(`INSERT INTO system_kv(k, v) VALUES('admin_totp_last', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(String(step)).run()
      return true
    }
  }
  return false
}
