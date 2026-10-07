import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { today } from '../api'
import { useCats, useMe } from '../hooks'
import { localTx } from '../offline/local'
import { TxEditor, TxList } from '../TxParts'
import { Seg } from '../ui'

// 明細(/detail)。行を押すと編集モーダル(削除はモーダル内のゴミ箱ボタン)
export default function Transactions() {
  const me = useMe().data!, { data: cats = [] } = useCats()
  const [sp, setSp] = useSearchParams()
  const ym = sp.get('ym') || today().slice(0, 7), type = (sp.get('type') || 'all') as 'all' | 'expense' | 'income', q = sp.get('q') || ''
  const upd = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }) }
  const { data: list = [] } = useQuery<any[]>({ queryKey: ['tx', type, ym, q], queryFn: () => localTx({ type, from: ym + '-01', to: ym + '-32', q }) })
  const [editor, setEditor] = useState<any>(undefined) // undefined=閉じる / null=作成 / 行=編集
  return (
    <main>
      <div className="row"><Seg value={type} options={[['all', '全部'], ['expense', '支出'], ['income', '収入']] as const} onChange={v => upd('type', v)} />
        <input type="month" aria-label="月" value={ym} onChange={e => upd('ym', e.target.value)} /><input placeholder="備考で検索" value={q} onChange={e => upd('q', e.target.value)} /></div>
      {me.perms.tx && <button onClick={() => setEditor(null)}>＋ 作成</button>}
      {list.length === 0 && <p className="mute">この月の明細はありません。「＋ 作成」から入力できます。</p>}
      <TxList rows={list} cats={cats} me={me} onPick={setEditor} />
      {editor !== undefined && <TxEditor init={editor ?? undefined} defaultType={type === 'income' ? 'income' : 'expense'} onClose={() => setEditor(undefined)} />}
    </main>)
}
