import { finish, jar, ok, req } from './lib.mjs'
// サイトキーだけ設定して秘密鍵がない(設定ミス)場合は、素通りさせず拒否する
const r = await req(jar(), 'POST', '/api/ledgers', { name: 'x', login_id: 'ts_user1', password: 'password123', turnstile: 'anything' })
ok('秘密鍵なしでサイトキーだけの設定 → 登録は拒否', r.s === 403, r)
ok('ログインも拒否', (await req(jar(), 'POST', '/api/login', { login_id: 'ts_user1', password: 'password123' })).s === 403)
ok('configはサイトキーを返す', (await req(null, 'GET', '/api/config')).d.turnstileSiteKey === 'site-key-only')
finish()
