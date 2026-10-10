import http from 'node:http'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { adm, finish, jar, ok, reg, req, sleep, tx } from './lib.mjs'

const pushes = []
http.createServer((rq, rs) => { let n = 0; rq.on('data', d => (n += d.length)); rq.on('end', () => { pushes.push({ url: rq.url, auth: rq.headers.authorization, enc: rq.headers['content-encoding'], len: n }); rs.writeHead(201); rs.end() }) }).listen(9998)
const mkSub = () => { const j = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' }); return { p256dh: Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url'), auth: randomBytes(16).toString('base64url') } }

// ===== 登録・ログイン =====
const A = await reg('太郎', 'Taro_01')
ok('登録(表示名+ID+パスワード)', A.r.s === 200 && A.me.login_id === 'taro_01' && A.me.has_password, A.r)
ok('IDは小文字に正規化され、重複は409', (await req(jar(), 'POST', '/api/ledgers', { name: 'x', login_id: 'TARO_01', password: 'password123' })).s === 409)
ok('短いID/弱いパスワードは400', (await req(jar(), 'POST', '/api/ledgers', { name: 'x', login_id: 'ab', password: 'password123' })).s === 400 && (await req(jar(), 'POST', '/api/ledgers', { name: 'x', login_id: 'okuser', password: 'short' })).s === 400)
const j1 = jar()
ok('IDとパスワードでログイン', (await req(j1, 'POST', '/api/login', { login_id: 'TARO_01', password: 'password123' })).s === 200 && (await req(j1, 'GET', '/api/me')).d.name === '太郎')
ok('パスワード違いは401(IDの有無を区別しない)', (await req(jar(), 'POST', '/api/login', { login_id: 'taro_01', password: 'wrongwrong' })).s === 401 && (await req(jar(), 'POST', '/api/login', { login_id: 'nobody1', password: 'wrongwrong' })).s === 401)
ok('APIにパスワードのハッシュを返さない', !/hash|v1\$/.test(JSON.stringify((await req(j1, 'GET', '/api/me')).d)))
ok('現在のパスワードなしでは変更不可', (await req(A.j, 'PUT', '/api/me/credentials', { password: 'newpassword1' })).s === 403)
ok('パスワード変更', (await req(A.j, 'PUT', '/api/me/credentials', { current_password: 'password123', password: 'newpassword1' })).s === 200)
ok('変更後、他の端末のセッションは無効', (await req(j1, 'GET', '/api/me')).s === 401 && (await req(A.j, 'GET', '/api/me')).s === 200)
ok('新パスワードでログイン/旧は不可', (await req(jar(), 'POST', '/api/login', { login_id: 'taro_01', password: 'newpassword1' })).s === 200 && (await req(jar(), 'POST', '/api/login', { login_id: 'taro_01', password: 'password123' })).s === 401)
ok('ID変更(重複は409)', (await req((await reg('花', 'hana_01')).j, 'PUT', '/api/me/credentials', { current_password: 'password123', login_id: 'taro_01' })).s === 409)

// ===== ログインの試行制限(失敗だけを数える) =====
const L = await reg('制限テスト', 'limit_01', 'goodpassword1'), ipX = '198.51.100.1'
const tryLogin = (pw, ip) => req(null, 'POST', '/api/login', { login_id: 'limit_01', password: pw }, { ip })
for (let i = 0; i < 10; i++) await tryLogin('goodpassword1', '198.51.100.50')
ok('成功したログインは制限に数えない(10回連続でOK)', (await tryLogin('goodpassword1', '198.51.100.50')).s === 200)
for (let i = 0; i < 5; i++) await tryLogin('wrongwrong1', ipX)
ok('同じIP×IDで5回失敗すると、正しいパスワードでも429', (await tryLogin('goodpassword1', ipX)).s === 429)
ok('別のIPからは、本人はログインできる(第三者に締め出されない)', (await tryLogin('goodpassword1', '198.51.100.2')).s === 200)
const L2 = await reg('全体制限', 'limit_02', 'goodpassword1')
for (let i = 0; i < 20; i++) await req(null, 'POST', '/api/login', { login_id: 'limit_02', password: 'wrongwrong1' }, { ip: `192.0.2.${i + 1}` })
ok('同じIDで20回失敗(複数IP)すると、全体でも一時的に429', (await req(null, 'POST', '/api/login', { login_id: 'limit_02', password: 'goodpassword1' }, { ip: '192.0.2.200' })).s === 429)

// ===== メンバー管理 =====
const inv = await req(A.j, 'POST', '/api/members/invite', { note: '妻用', can_budget: false })
ok('招待(備考つき)', inv.s === 200 && inv.d.code?.startsWith('U-'), inv)
const U = jar(); await req(U, 'POST', '/api/join', { code: inv.d.code, name: '花子' })
const list = (await req(A.j, 'GET', '/api/members')).d.find(m => m.role === 'user')
ok('備考と権限(予算だけOFF、他は初期値ON)', list.note === '妻用' && list.can_tx && list.can_category && list.can_sub && !list.can_budget, list)
const inv2 = (await req(A.j, 'POST', '/api/members/invite', {})).d
const l2 = (await req(A.j, 'GET', '/api/members')).d.find(m => m.id === inv2.id)
ok('権限の初期値はすべてON', l2.can_tx && l2.can_category && l2.can_sub && l2.can_budget, l2)
await req(A.j, 'PUT', '/api/members/' + list.id, { note: '妻(スマホ)' })
ok('備考の編集', (await req(A.j, 'GET', '/api/members')).d.find(m => m.id === list.id).note === '妻(スマホ)')
ok('権限のないユーザーは予算を変更できない', (await req(U, 'PUT', '/api/budgets', { items: [] })).s === 403)
const U2 = jar(); await req(U2, 'POST', '/api/join', { code: inv2.code, name: '次郎' })
await req(U2, 'PUT', '/api/me/credentials', { login_id: 'jiro_01', password: 'jirojiro1' })
ok('ユーザーも自分でIDとパスワードを設定できる', (await req(jar(), 'POST', '/api/login', { login_id: 'jiro_01', password: 'jirojiro1' })).s === 200)
await req(A.j, 'DELETE', '/api/members/' + inv2.id, {})
ok('無効化したメンバーはログイン不可(IDは解放)', (await req(jar(), 'POST', '/api/login', { login_id: 'jiro_01', password: 'jirojiro1' })).s === 401 && (await reg('次', 'jiro_01')).r.s === 200)
const aTx = await req(A.j, 'PUT', '/api/transactions/' + crypto.randomUUID(), { type: 'expense', date: '2026-10-01', category_id: A.cats[0].id, amount: 10, memo: 'owner-tx' })
ok('他メンバーの明細はユーザーが編集できない', (await req(U, 'PUT', '/api/transactions/' + aTx.d.id, { type: 'expense', date: '2026-10-01', category_id: A.cats[0].id, amount: 20 })).s === 403)

// ===== オーナー/メンバーの入口(コードに紐づくIDとパスワード) =====
const MO = await reg('入口', 'entry_own')
const invE = (await req(MO.j, 'POST', '/api/members/invite', { note: '入口テスト' })).d
const UM = jar(), jr = await req(UM, 'POST', '/api/join', { code: invE.code, name: 'メンバー太郎' })
ok('メンバーがコードで参加 → IDとパスワードが未設定なら作成を促す', jr.d.needs_credentials === true && jr.d.login_id === null, jr.d)
ok('コードに紐づけてIDとパスワードを1組作成(現在のパスワードは不要)', (await req(UM, 'PUT', '/api/me/credentials', { login_id: 'member_taro', password: 'memberpass1' })).s === 200)
const jr2 = await req(jar(), 'POST', '/api/join', { code: invE.code })
ok('同じコードでも入れる(ID・パスワードが分からなくても大丈夫)。作成は促さず、既存のログインIDを返す', jr2.s === 200 && jr2.d.needs_credentials === false && jr2.d.login_id === 'member_taro', jr2.d)
ok('メンバーがIDとパスワードでログイン', (await req(jar(), 'POST', '/api/login', { login_id: 'member_taro', password: 'memberpass1', role: 'user' })).s === 200)
ok('メンバーのIDを「オーナーでログイン」に入れると案内される(403)', (await req(jar(), 'POST', '/api/login', { login_id: 'member_taro', password: 'memberpass1', role: 'owner' })).s === 403)
ok('オーナーのIDを「メンバー」に入れると案内される(403)', (await req(jar(), 'POST', '/api/login', { login_id: 'entry_own', password: 'password123', role: 'user' })).s === 403)
ok('パスワード違いでは入口の情報を漏らさない(401)', (await req(jar(), 'POST', '/api/login', { login_id: 'entry_own', password: 'wrongwrong1', role: 'user' })).s === 401)
ok('入口の指定がなくても従来どおりログインできる', (await req(jar(), 'POST', '/api/login', { login_id: 'entry_own', password: 'password123' })).s === 200)

// ===== カテゴリの並び替え =====
const exIds = A.cats.filter(c => c.type === 'expense').map(c => c.id), rev = [...exIds].reverse()
const orderNow = async t => (await req(A.j, 'GET', '/api/categories')).d.filter(c => c.type === t).map(c => c.id)
ok('カテゴリの並び替え(順番が保存され、取得順に反映)', (await req(A.j, 'PUT', '/api/category-order', { type: 'expense', ids: rev })).s === 200 && JSON.stringify(await orderNow('expense')) === JSON.stringify(rev))
ok('1つ入れ替えただけでも反映', (await req(A.j, 'PUT', '/api/category-order', { type: 'expense', ids: [rev[1], rev[0], ...rev.slice(2)] })).s === 200 && (await orderNow('expense'))[0] === rev[1])
ok('種別違い・他の家計簿のID・重複は拒否', (await req(A.j, 'PUT', '/api/category-order', { type: 'income', ids: [exIds[0]] })).s === 400 && (await req(A.j, 'PUT', '/api/category-order', { type: 'expense', ids: [exIds[0], 999999] })).s === 400 && (await req(A.j, 'PUT', '/api/category-order', { type: 'expense', ids: [exIds[0], exIds[0]] })).s === 400)
const inv3 = (await req(A.j, 'POST', '/api/members/invite', { can_category: false })).d, U3 = jar(); await req(U3, 'POST', '/api/join', { code: inv3.code, name: '三郎' })
ok('カテゴリ編集の権限がないメンバーは並び替えできない', (await req(U3, 'PUT', '/api/category-order', { type: 'expense', ids: exIds })).s === 403)
ok('サブスクの解約日は空にして保存できる', await (async () => { const s = await req(A.j, 'POST', '/api/subscriptions', { name: 'Netflix', category_id: exIds[0], amount: 1000, start_date: '2026-01-01', end_date: '2026-10-08' }); await req(A.j, 'PUT', '/api/subscriptions/' + s.d.id, { name: 'Netflix', category_id: exIds[0], amount: 1000, start_date: '2026-01-01', end_date: '' }); return (await req(A.j, 'GET', '/api/subscriptions')).d.find(x => x.id === s.d.id).end_date === null })())

// ===== CSV =====
const cat = A.cats.find(c => c.name === '食費').id, inc = A.cats.find(c => c.name === '給与').id
const t1 = crypto.randomUUID()
await req(A.j, 'PUT', '/api/transactions/' + t1, { type: 'expense', date: '2026-10-03', category_id: cat, amount: 1200, memo: '=SUM(A1)' })
await req(A.j, 'PUT', '/api/transactions/' + crypto.randomUUID(), { type: 'income', date: '2026-10-25', category_id: inc, amount: 300000, memo: 'カンマ,入り "引用"' })
const csv = (await req(A.j, 'GET', '/api/export/csv?year=2026', undefined, { raw: true })).d
ok('CSV見出し(入力者の隣が入力者ID)', csv.replace(/^\uFEFF/, '').split('\r\n')[0] === '日付,種別,カテゴリ,金額,備考,入力者,入力者ID,明細ID')
const B2 = await reg('別家計簿', 'other_01')
const dry = await req(B2.j, 'POST', '/api/import/csv', { csv, dry_run: true })
ok('取込のプレビュー(エラーなし)', dry.s === 200 && dry.d.imported === 3 && dry.d.error_count === 0, dry.d)
const real = await req(B2.j, 'POST', '/api/import/csv', { csv })
const got = (await req(B2.j, 'GET', '/api/transactions?year=2026')).d
ok('取込実行(金額・備考が復元)', real.s === 200 && got.some(t => t.memo === '=SUM(A1)' && t.amount === 1200) && got.some(t => t.memo === 'カンマ,入り "引用"'), [real.d, got.length])
ok('同じ家計簿への再取込は更新扱い', (await req(A.j, 'POST', '/api/import/csv', { csv, dry_run: true })).d.updated === 3)
const T3 = await reg('第三', 'third_01')
const r3 = await req(T3.j, 'POST', '/api/import/csv', { csv: '日付,種別,カテゴリ,金額,備考,明細ID\n2026-10-03,支出,食費,999,乗っ取り,' + t1 })
const aRow = (await req(A.j, 'GET', '/api/transactions?year=2026')).d.find(t => t.id === t1)
ok('他の家計簿の明細IDは使わず新規として取り込む(元は変わらない)', r3.d.imported === 1 && aRow.amount === 1200, [r3.d, aRow])
const bad = await req(B2.j, 'POST', '/api/import/csv', { csv: '日付,種別,カテゴリ,金額\n2026-13-45,支出,食費,100\n2026-01-01,その他,食費,100\n2026-01-01,支出,食費,abc' })
ok('不正な行はエラー(行番号つき)・実行は拒否', bad.s === 400 && bad.d.error_count === 3 && bad.d.errors[0].line === 2, bad.d)
const ok2 = await req(B2.j, 'POST', '/api/import/csv', { csv: '日付,種別,カテゴリ,金額,備考\n2026/1/2,支出,新カテゴリ,"¥1,500",メモ' })
ok('日付の形式ゆれ・¥/カンマ・未登録カテゴリの自動作成', ok2.s === 200 && (await req(B2.j, 'GET', '/api/categories')).d.some(c => c.name === '新カテゴリ'), ok2.d)
ok('取込はオーナーのみ', (await req(U, 'POST', '/api/import/csv', { csv, dry_run: true })).s === 403)

// ===== 通知・お知らせ・予算 =====
const N = await reg('通知', 'notify_01'), ep = 'http://127.0.0.1:9998/p1'
ok('購読登録/不正なendpointは拒否', (await req(N.j, 'POST', '/api/push/subscribe', { endpoint: ep, keys: mkSub() })).s === 200 && (await req(N.j, 'POST', '/api/push/subscribe', { endpoint: 'https://evil.example/x', keys: mkSub() })).s === 400)
await req(N.j, 'PUT', '/api/me/notifications', { notify_budget: true, endpoint: ep })
await adm('POST', '/announcements', { title: '定期メンテ', body: '本文', target: 'all', send_push: true }); await sleep(800)
ok('お知らせのプッシュ(VAPID・暗号化済み)', pushes.length === 1 && pushes[0].auth?.startsWith('vapid ') && pushes[0].enc === 'aes128gcm', pushes)
ok('未読数(お知らせ1)', (await req(N.j, 'GET', '/api/unread-count')).d.announcements === 1)
await adm('POST', '/announcements', { title: 'ユーザー向け', body: 'x', target: 'user', send_push: false })
const al = (await req(N.j, 'GET', '/api/announcements')).d
ok('対象外はオーナーに見えない', al.length === 1)
await req(N.j, 'POST', `/api/announcements/${al[0].id}/read`, {})
ok('既読で未読0', (await req(N.j, 'GET', '/api/unread-count')).d.announcements === 0)
const inq = (await req(N.j, 'POST', '/api/inquiries', { kind: 'question', body: 'こんにちは' })).d.id
await adm('POST', `/inquiries/${inq}/reply`, { body: '返信です' }); await sleep(800)
ok('返信のプッシュ', pushes.length === 2)
ok('他人の問い合わせは見えない', (await req(A.j, 'GET', '/api/inquiries/' + inq)).s === 404)
const bc = N.cats.find(c => c.type === 'expense').id
await req(N.j, 'PUT', '/api/budgets', { items: [{ category_id: null, month: null, amount: 1000 }, { category_id: bc, month: null, amount: 1000 }] })
await tx(N, bc, 800); await sleep(800)
ok('80%到達で通知(全体+カテゴリ)', pushes.length === 4, pushes.length)
await tx(N, bc, 300); await sleep(800)
ok('100%超過で通知', pushes.length === 6, pushes.length)
await tx(N, bc, 100); await sleep(800)
ok('同じ段階では再通知しない', pushes.length === 6, pushes.length)
await adm('POST', '/announcements', { title: '予約配信', body: 'x', target: 'owner', send_push: true, publish_at: new Date(Date.now() + 2500).toISOString() }); await sleep(800)
ok('予約中は配信されない', pushes.length === 6)
await sleep(2500)
const cr = await fetch(new URL('/cdn-cgi/handler/scheduled', process.env.BASE)); await sleep(1500)
ok('Cronが予約お知らせを配信', cr.status === 200 && pushes.length === 7, [cr.status, pushes.length])

// ===== 引き継ぎ(統合) =====
const OLD = await reg('花子', 'hanako_old'); const oc = n => OLD.cats.find(c => c.name === n).id
await tx(OLD, oc('食費'), 1000, 'old-1'); await tx(OLD, oc('交通費'), 500, 'old-2')
await req(OLD.j, 'PUT', '/api/budgets', { items: [{ category_id: null, month: null, amount: 50000 }] })
const NEW = await reg('花子(新)', 'hanako_new', 'newpassword9'); const nc = n => NEW.cats.find(c => c.name === n).id
const newCode = (await req(NEW.j, 'POST', '/api/me/owner-code', {})).d.code
await tx(NEW, nc('食費'), 700, 'new-1')
const pet = (await req(NEW.j, 'POST', '/api/categories', { type: 'expense', name: 'ペット', icon: '🐶' })).d.id
await tx(NEW, pet, 900, 'new-pet')
await req(NEW.j, 'PUT', '/api/budgets', { items: [{ category_id: null, month: null, amount: 99999 }, { category_id: pet, month: null, amount: 5000 }] })
ok('申請送信/同時に1件まで', (await req(NEW.j, 'POST', '/api/recovery', { prev_name: '花子', period: '春', recent: '食費 1000円' })).s === 200 && (await req(NEW.j, 'POST', '/api/recovery', { prev_name: 'x', recent: 'y' })).s === 400)
const rid = (await adm('GET', '/recovery')).d.find(x => x.new_name === '花子(新)').id
const cands = (await adm('GET', `/recovery/${rid}/candidates?name=${encodeURIComponent('花子')}`)).d
ok('候補検索(自分自身は除外)', cands.length === 1 && cands[0].name === '花子', cands)
ok('直近明細のプレビュー', (await adm('GET', `/recovery/${rid}/preview?member_id=${cands[0].member_id}`)).d.transactions.length === 2)
ok('統合の実行', (await adm('POST', `/recovery/${rid}/merge`, { candidate_member_id: cands[0].member_id })).s === 200)
ok('新オーナーのCookieが旧家計簿を参照', (await req(NEW.j, 'GET', '/api/me')).d.ledger_id === OLD.me.ledger_id)
const txs = (await req(NEW.j, 'GET', '/api/transactions?year=' + new Date().getFullYear())).d
ok('明細が統合・入力者は旧オーナー', ['old-1', 'old-2', 'new-1', 'new-pet'].every(m => txs.some(t => t.memo === m)) && txs.find(t => t.memo === 'new-1').created_by === OLD.me.id)
const cats2 = (await req(NEW.j, 'GET', '/api/categories')).d
ok('カテゴリ: 一致は重複せず、一致しないものは追加', cats2.filter(c => c.name === '食費').length === 1 && cats2.filter(c => c.name === 'ペット').length === 1 && txs.find(t => t.memo === 'new-1').category_id === oc('食費'))
const bud = (await req(NEW.j, 'GET', '/api/budgets')).d
ok('予算: 旧を優先し、ない分だけ追加', bud.find(b => !b.category_id).amount === 50000 && bud.some(b => b.category_id === pet))
const late = await req(NEW.j, 'PUT', '/api/transactions/' + crypto.randomUUID(), { type: 'expense', date: new Date().toISOString().slice(0, 10), category_id: nc('食費'), amount: 111, memo: 'late' })
ok('統合前のカテゴリIDで届いた入力は対応表で付け替え', late.s === 200 && (await req(NEW.j, 'GET', '/api/transactions?q=late')).d[0]?.category_id === oc('食費'))
const jc = jar()
ok('新しいオーナーコード/ID・パスワードで旧家計簿に入れる', (await req(jc, 'POST', '/api/join', { code: newCode })).s === 200 && (await req(jc, 'GET', '/api/me')).d.ledger_id === OLD.me.ledger_id)
const jm = jar(); await req(jm, 'POST', '/api/login', { login_id: 'hanako_new', password: 'newpassword9' })
ok('ID/パスワードは新しい方に置き換え(旧IDは不可)', (await req(jm, 'GET', '/api/me')).d.ledger_id === OLD.me.ledger_id && (await req(jar(), 'POST', '/api/login', { login_id: 'hanako_old', password: 'password123' })).s === 401)
const X = await reg('別人', 'person_x'); await req(X.j, 'POST', '/api/recovery', { prev_name: '花子', recent: 'x' })
const xr = (await adm('GET', '/recovery')).d.find(v => v.new_name === '別人')
ok('同じ家計簿の別申請はブロック/却下できる', (await adm('GET', `/recovery/${xr.id}/preview?member_id=${cands[0].member_id}`)).s === 400 && (await adm('POST', `/recovery/${xr.id}/reject`, {})).s === 200)

// ===== 家計簿の削除・メンバー検索 =====
const D = await reg('削除テスト', 'delete_01'); await tx(D, D.cats[0].id, 100)
ok('家計簿の削除→ログイン不可', (await req(D.j, 'DELETE', '/api/ledger', {})).s === 200 && (await req(D.j, 'GET', '/api/me')).s === 401)
ok('管理者: メンバー検索(金額は含まない)', JSON.stringify((await adm('GET', '/members?q=' + encodeURIComponent('太郎'))).d).includes('tx_count'))

// ===== 総当たり・不正な送信元 =====
let last = 0; for (let i = 0; i < 35; i++) last = (await req(null, 'POST', '/api/join', { code: 'O-' + crypto.randomUUID() }, { ip: '203.0.113.77' })).s
ok('コード入力の総当たりはレート制限(429)', last === 429, last)
ok('他サイトからの送信は拒否', (await req(jar(), 'POST', '/api/ledgers', { name: 'x', login_id: 'evil_01', password: 'password123' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).s === 403)
finish()
