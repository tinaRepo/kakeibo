// APIテストの実行: npm test
// テスト用のWorkerをローカルで起動(ポート8788・専用のDB)し、スイートごとに環境変数を変えて実行する。ローカル開発のDBには触れない
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateKeyPairSync, pbkdf2Sync, randomBytes } from 'node:crypto'

const PORT = 8788, STATE = '.wrangler/test-state', BASE = `http://127.0.0.1:${PORT}`
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const only = process.argv[2]
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = jwk.publicKey.export({ format: 'jwk' }), prv = jwk.privateKey.export({ format: 'jwk' })
const vapid = { VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'), VAPID_PRIVATE_KEY: prv.d }
const salt = randomBytes(16), ADMIN_PW = 'test-admin-password-123'
const adminVars = { ADMIN_PASSWORD_HASH: `v1$100000$${salt.toString('base64')}$${pbkdf2Sync(ADMIN_PW, salt, 100000, 32, 'sha256').toString('base64')}`, ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'), ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' }

const suites = [
  { name: 'API(通常の機能)', run: ['node', 'tests/main.test.mjs'], vars: { ADMIN_DEV_BYPASS: 'true', ...vapid } },
  { name: '管理者ログイン(パスワード+確認コード)', run: ['node', 'tests/admin-auth.test.mjs'], vars: adminVars, env: { ADMIN_PW, TOTP_SECRET: adminVars.ADMIN_TOTP_SECRET } },
  { name: '管理者の認証が未設定', run: ['node', 'tests/admin-unset.test.mjs'], vars: {} },
  { name: 'Turnstileの設定ミス(秘密鍵なし)', run: ['node', 'tests/turnstile.test.mjs'], vars: { TURNSTILE_SITE_KEY: 'site-key-only' } },
  { name: '端末内DBと同期', run: [npx, 'tsx', 'tests/sync.test.mts'], vars: {} },
  { name: 'Cloudflare Access のトークン検証', run: [npx, 'tsx', 'tests/access.test.mts'], noServer: true },
]

const kill = c => { try { process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F']) : process.kill(-c.pid, 'SIGTERM') } catch { /* 終了済み */ } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = []
for (const s of suites) {
  if (only && !s.name.includes(only) && !s.run.join(' ').includes(only)) continue
  console.log(`\n━━ ${s.name} ━━`)
  let server
  if (!s.noServer) {
    rmSync(STATE, { recursive: true, force: true })
    const mig = spawnSync(npx, ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE], { encoding: 'utf8' })
    if (mig.status !== 0) { console.error(mig.stdout, mig.stderr); process.exit(1) }
    const vars = Object.entries(s.vars || {}).flatMap(([k, v]) => ['--var', `${k}:${v}`])
    server = spawn(npx, ['wrangler', 'dev', '--port', String(PORT), '--persist-to', STATE, '--test-scheduled', ...vars], { detached: process.platform !== 'win32', stdio: 'ignore' })
    let up = false
    for (let i = 0; i < 90 && !up; i++) { await sleep(1000); up = await fetch(`${BASE}/api/config`).then(r => r.ok).catch(() => false) }
    if (!up) { console.error('テスト用サーバーが起動しませんでした'); kill(server); process.exit(1) }
  }
  const r = spawnSync(s.run[0], s.run.slice(1), { stdio: 'inherit', env: { ...process.env, BASE, ...(s.env || {}) } })
  if (server) { kill(server); await sleep(1500) }
  if (r.status !== 0) failed.push(s.name)
}
rmSync(STATE, { recursive: true, force: true })
console.log(failed.length ? `\n✗ 失敗したスイート: ${failed.join(' / ')}` : '\n✓ すべてのテストに成功しました')
process.exit(failed.length ? 1 : 0)
