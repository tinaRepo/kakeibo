// パスワードは PBKDF2-SHA256(Workersの上限である10万回)+ソルトで保存する。平文は保存しない
const ITER = 100_000
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
async function derive(pw: string, salt: Uint8Array, iterations: number) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, k, 256))
}
export async function hashPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `v1$${ITER}$${b64(salt)}$${b64(await derive(pw, salt, ITER))}`
}
// 保存値がなくても同じ計算を行い、IDの存在が応答時間で分からないようにする
const DUMMY = 'v1$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
export async function verifyPassword(pw: string, stored: string | null) {
  const [, it, s, h] = (stored || DUMMY).split('$')
  const got = await derive(pw, unb64(s), +it), want = unb64(h)
  let d = got.length ^ want.length
  for (let i = 0; i < got.length; i++) d |= got[i] ^ (want[i] ?? 0)
  return !!stored && d === 0
}
export const normId = (s: unknown) => String(s ?? '').trim().toLowerCase()
export const validLoginId = (s: string) => /^[a-z0-9._-]{4,32}$/.test(s)
export const validPassword = (s: unknown): s is string => typeof s === 'string' && s.length >= 8 && s.length <= 128
