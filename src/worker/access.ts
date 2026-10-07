// Cloudflare Access のJWT(Cf-Access-Jwt-Assertion)を検証する。成功すればメールアドレスを返す
type AccessEnv = { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }
let jwks: { at: number; keys: any[] } | null = null
const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64u(s)))

export async function verifyAccess(env: AccessEnv, jwt: string): Promise<string | null> {
  try {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null // 未設定なら拒否(安全側)
    const [h, p, s] = jwt.split('.')
    if (!h || !p || !s) return null
    const head = json(h), pay = json(p), iss = `https://${env.ACCESS_TEAM_DOMAIN}`
    const aud = Array.isArray(pay.aud) ? pay.aud : [pay.aud]
    if (head.alg !== 'RS256' || pay.iss !== iss || !aud.includes(env.ACCESS_AUD) || !(pay.exp * 1000 > Date.now())) return null
    if (!jwks || Date.now() - jwks.at > 3600e3 || !jwks.keys.some(k => k.kid === head.kid))
      jwks = { at: Date.now(), keys: ((await (await fetch(`${iss}/cdn-cgi/access/certs`)).json()) as any).keys }
    const jwk = jwks.keys.find(k => k.kid === head.kid)
    if (!jwk) return null
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`))
    return ok ? String(pay.email || 'admin') : null
  } catch { return null }
}
