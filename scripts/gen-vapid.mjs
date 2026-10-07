// VAPID鍵ペアを生成: node scripts/gen-vapid.mjs
import { generateKeyPairSync } from 'node:crypto'
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' })
const b = s => s
const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url')
console.log(`VAPID_PUBLIC_KEY=${pubRaw}\nVAPID_PRIVATE_KEY=${prv.d}`)
console.log('\n公開鍵 → wrangler.toml の VAPID_PUBLIC_KEY / ローカルは .dev.vars に両方\n秘密鍵 → npx wrangler secret put VAPID_PRIVATE_KEY')
