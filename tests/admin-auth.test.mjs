import { createHmac } from 'node:crypto'
import { finish, jar, ok, req, reg } from './lib.mjs'

const SECRET = process.env.TOTP_SECRET, PW = process.env.ADMIN_PW
const b32 = s => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = []; for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
const totp = step => { const m = Buffer.alloc(8); m.writeUInt32BE(step, 4); const h = createHmac('sha1', b32(SECRET)).update(m).digest(), o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0') }
const now = Math.floor(Date.now() / 30000)

const st = (await req(null, 'GET', '/api/admin-auth/status')).d
ok('未ログインの状態(パスワード設定あり・確認コードあり)', st.authed === false && st.password && st.totp, st)
ok('未ログインでは管理者APIは403', (await req(null, 'GET', '/api/admin/stats')).s === 403 && (await req(null, 'GET', '/api/admin/members')).s === 403)
ok('一般ユーザーのCookieでも管理者APIは403', (await req((await reg('一般', 'plain_01')).j, 'GET', '/api/admin/stats')).s === 403)
ok('偽のAccessトークンは拒否', (await req(null, 'GET', '/api/admin/stats', undefined, { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } })).s === 403)

const A = jar()
ok('パスワードだけでは入れない(確認コードが必要)', (await req(A, 'POST', '/api/admin-auth/login', { password: PW })).s === 401)
ok('パスワード違いは401', (await req(A, 'POST', '/api/admin-auth/login', { password: 'wrong-password-1', code: totp(now) })).s === 401)
ok('確認コード違いは401', (await req(A, 'POST', '/api/admin-auth/login', { password: PW, code: '000000' })).s === 401)
const good = totp(now)
const li = await req(A, 'POST', '/api/admin-auth/login', { password: PW, code: good })
ok('パスワード+確認コードでログイン', li.s === 200, li)
ok('ログイン後は管理者APIが使える', (await req(A, 'GET', '/api/admin/stats')).s === 200 && (await req(A, 'GET', '/api/admin-auth/status')).d.authed === true)
ok('同じ確認コードは再利用できない(リプレイ対策)', (await req(jar(), 'POST', '/api/admin-auth/login', { password: PW, code: good })).s === 401)
ok('偽のセッションCookieは無効', (await req({ c: 'admin=abc.def' }, 'GET', '/api/admin/stats')).s === 403)
const tampered = A.c.replace(/^(\w+=)([^.]+)\./, (_m, p, pay) => p + Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url') + '.')
ok('署名を改ざんしたCookieは無効', (await req({ c: tampered }, 'GET', '/api/admin/stats')).s === 403)
await req(A, 'POST', '/api/admin-auth/logout', {})
ok('ログアウト(Cookie削除)', (await req(A, 'GET', '/api/admin-auth/status')).d.authed === false)

// 失敗が続くと、正しい情報でも一時的に拒否される(同じIPは5回まで)
const ip = '198.51.100.99'
for (let i = 0; i < 5; i++) await req(null, 'POST', '/api/admin-auth/login', { password: 'wrong-password-1', code: '123456' }, { ip })
ok('失敗が5回続くと、正しい情報でも429', (await req(null, 'POST', '/api/admin-auth/login', { password: PW, code: totp(now + 1) }, { ip })).s === 429)
finish()
