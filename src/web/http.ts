// 通信の共通処理(画面にもService Workerにも使うので、DOMに依存しない)
export const api = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .catch(() => { throw new Error('サーバーに接続できません。通信状態を確認してください(オフライン中は、明細の入力以外の操作はできません)') })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `通信に失敗しました(HTTP ${r.status})。APIサーバー(npm run dev:api)とDB初期化(npm run db:migrate)を確認してください`), { status: r.status })
  return j
}
