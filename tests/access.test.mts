import { verifyAccess } from '../src/worker/access.ts'
const env = { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123' }
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256' }
const b = (o: any) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const sign = async (pay: any, kid = 'k1') => { const h = b({ alg: 'RS256', kid }), p = b(pay); const s = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`))).toString('base64url'); return `${h}.${p}.${s}` }
globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as any
const base = { iss: 'https://team.cloudflareaccess.com', aud: ['aud123'], exp: Math.floor(Date.now() / 1000) + 600, email: 'me@example.com' }
let fails = 0
const t = (n: string, c: boolean) => { if (!c) fails++; console.log(c ? 'OK  ' : 'FAIL', n) }
t('正しいJWT → メール', (await verifyAccess(env, await sign(base))) === 'me@example.com')
t('audが違う → 拒否', (await verifyAccess(env, await sign({ ...base, aud: ['x'] }))) === null)
t('issが違う → 拒否', (await verifyAccess(env, await sign({ ...base, iss: 'https://evil.example' }))) === null)
t('期限切れ → 拒否', (await verifyAccess(env, await sign({ ...base, exp: 1 }))) === null)
const good = await sign(base), [h, , s] = good.split('.')
t('ペイロード改ざん → 拒否', (await verifyAccess(env, `${h}.${b({ ...base, email: 'evil@example.com' })}.${s}`)) === null)
t('kid不明 → 拒否', (await verifyAccess(env, await sign(base, 'zzz'))) === null)
t('設定なし → 拒否', (await verifyAccess({}, good)) === null)
console.log(fails ? `\n${fails}件失敗` : '\n全て成功'); process.exit(fails ? 1 : 0)
