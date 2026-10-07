import { finish, ok, req } from './lib.mjs'
const st = (await req(null, 'GET', '/api/admin-auth/status')).d
ok('管理者の認証が未設定なら、すべて拒否(安全側)', st.authed === false && !st.password, st)
ok('管理者APIは403', (await req(null, 'GET', '/api/admin/stats')).s === 403)
ok('ログインも403(設定がない)', (await req(null, 'POST', '/api/admin-auth/login', { password: 'whatever-whatever' })).s === 403)
finish()
