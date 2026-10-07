// 管理者ログインの秘密を作る: npm run admin:setup
// 出力された3つの値を、環境ごとに `npx wrangler secret put 名前 --env dev|production` で登録する(ファイルには書かない)
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

// パスワードの入力は画面に表示しない(パイプ入力でも動くよう、行を順に読む)
const out = new Writable({ write(_c, _e, cb) { cb() } })
const rl = createInterface({ input: process.stdin, output: out, terminal: !!process.stdin.isTTY })
const lines = rl[Symbol.asyncIterator]()
const ask = async q => { process.stdout.write(q); const { value } = await lines.next(); process.stdout.write('\n'); return value ?? '' }

const pw = await ask('管理者パスワード(12文字以上。入力は表示されません): ')
const pw2 = await ask('もう一度: ')
rl.close()
if (pw.length < 12) { console.error('12文字以上にしてください'); process.exit(1) }
if (pw !== pw2) { console.error('一致しません'); process.exit(1) }

const salt = randomBytes(16)
const hash = `v1$100000$${salt.toString('base64')}$${pbkdf2Sync(pw, salt, 100000, 32, 'sha256').toString('base64')}`
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
let bits = '', totp = ''
for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, '0')
for (let i = 0; i < bits.length; i += 5) totp += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
const uri = `otpauth://totp/${encodeURIComponent('家計簿 管理者')}?secret=${totp}&issuer=Kakeibo`

console.log('\n=== Secrets に登録する値(環境ごとに、別の値を作ってください) ===')
console.log(`ADMIN_PASSWORD_HASH=${hash}`)
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString('base64url')}`)
console.log(`ADMIN_TOTP_SECRET=${totp}`)
console.log('\n=== 確認コード(認証アプリ)の登録 ===')
console.log('下のQRコードを、認証アプリ(Google Authenticator / Microsoft Authenticator / 1Password など)で読み取ってください。')
console.log(`読み取れない場合は、手動入力で「キー: ${totp}」「種類: 時間ベース」を登録します。\n`)
console.log(await QRCode.toString(uri, { type: 'terminal', small: true }))
console.log('登録コマンド(値の入力を求められます):')
for (const k of ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'ADMIN_TOTP_SECRET']) console.log(`  npx wrangler secret put ${k} --env dev`)
console.log('(本番は --env production)')
