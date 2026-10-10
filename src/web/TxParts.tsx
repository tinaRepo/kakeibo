import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError, today, yen } from './api'
import { compress } from './image'
import { useCats, useMe } from './hooks'
import { deleteLocal, saveLocal } from './offline/local'
import { requestBackgroundSync, runSync } from './offline/sync'
import { AmountInput, Modal, Seg, TrashIcon, catIcon, useConfirm } from './ui'

const WD = '日月火水木金土'
const dayLabel = (d: string) => { const x = new Date(d + 'T00:00:00'); return `${x.getMonth() + 1}月${x.getDate()}日(${WD[x.getDay()]})` }
const MAX_IMG = 5

// 明細1行: アイコン・内容(カテゴリ)・金額 / 備考 / (自分以外が作成したときは)作成者。押すと編集モーダル
export function TxRow({ t, cat, me, onClick }: { t: any; cat: any; me: any; onClick: (t: any) => void }) {
  const editable = !t.ro && me.perms.tx && (me.role === 'owner' || t.created_by === me.id)
  const body = (<>
    <span className="ico" aria-hidden>{catIcon(cat)}</span>
    <div className="tx-body">
      <div className="tx-top"><span>{cat?.name}{t.rc > 0 && ` 🧾${t.rc}`}{t._pending ? <span className="mute"> ・未同期</span> : null}</span>
        <b className={t.type === 'income' ? 'income' : ''}>{t.type === 'income' ? '+' : ''}{yen(t.amount)}</b></div>
      {t.memo && <div className="mute">{t.memo}</div>}
      {!t.ro && t.created_by !== me.id && <div className="mute">作成者: {t.creator || '削除されたユーザー'}</div>}
    </div></>)
  return editable
    ? <button className="tx tx-btn" onClick={() => onClick(t)} aria-label={`${cat?.name || ''} ${yen(t.amount)} を編集`}>{body}</button>
    : <div className="tx">{body}</div>
}

export function TxList({ rows, cats, me, onPick }: { rows: any[]; cats: any[]; me: any; onPick: (t: any) => void }) {
  return <>{rows.map((t, i) => (
    <div key={t.id}>
      {(i === 0 || rows[i - 1].date !== t.date) && <div className="day">{dayLabel(t.date)}</div>}
      <TxRow t={t} cat={cats.find(c => c.id === t.category_id)} me={me} onClick={onPick} />
    </div>))}</>
}

function Preview({ file }: { file: File }) {
  const [u, setU] = useState('')
  useEffect(() => { const x = URL.createObjectURL(file); setU(x); return () => URL.revokeObjectURL(x) }, [file])
  return <img src={u} alt="追加予定のレシート" />
}

// 作成・編集モーダル(支出/収入の切り替え、削除=ゴミ箱ボタン、レシート画像)
export function TxEditor({ init, defaultType = 'expense', onClose }: { init?: any; defaultType?: 'expense' | 'income'; onClose: () => void }) {
  useMe() // 権限の再取得用
  const { data: cats = [] } = useCats(), qc = useQueryClient(), ask = useConfirm()
  const [f, setF] = useState<any>(() => init
    ? { id: init.id, type: init.type, date: init.date, category_id: init.category_id, amount: String(init.amount), memo: init.memo || '', receipts: init.receipt_ids ? init.receipt_ids.split(',') : [], files: [] }
    : { id: crypto.randomUUID(), type: defaultType, date: today(), category_id: '', amount: '', memo: '', receipts: [], files: [] })
  const tc = cats.filter(c => c.type === f.type && (c.is_active || c.id === +f.category_id))
  useEffect(() => { if (!tc.some(c => c.id === +f.category_id)) setF((x: any) => ({ ...x, category_id: tc[0]?.id ?? '' })) }, [f.type, cats.length])
  const done = () => { qc.invalidateQueries({ queryKey: ['tx'] }); qc.invalidateQueries({ queryKey: ['summary'] }); requestBackgroundSync(); runSync(qc) }
  const save = useMutation({
    mutationFn: async () => {
      const blobs = await Promise.all(f.files.map((x: File) => compress(x))) // 端末側で圧縮・EXIF除去
      await saveLocal({ id: f.id, type: f.type, date: f.date, category_id: +f.category_id, amount: +f.amount, memo: f.memo }, blobs, (qc.getQueryData(['me']) as any).id)
    },
    onSuccess: () => { done(); onClose() }, onError,
  })
  const del = useMutation({ mutationFn: () => deleteLocal(f.id), onSuccess: () => { done(); onClose() }, onError })
  const delImg = useMutation({
    mutationFn: async (id: string) => { if (!navigator.onLine) throw new Error('オフライン中は登録済みの画像を削除できません'); await api('/receipts/' + id, 'DELETE') },
    onSuccess: (_, id) => { setF((x: any) => ({ ...x, receipts: x.receipts.filter((r: string) => r !== id) })); done() }, onError,
  })
  const count = f.receipts.length + f.files.length
  return (
    <Modal title={init ? '明細を編集' : '明細を作成'} onClose={() => !save.isPending && onClose()}
      action={init && <button type="button" className="icon-btn" aria-label="この明細を削除" onClick={() => ask('この明細を削除しますか?(添付した画像も削除されます)', { ok: '削除', danger: true }).then(ok => ok && del.mutate())}><TrashIcon /></button>}>
      <div className="field"><Seg full value={f.type} options={[['expense', '支出'], ['income', '収入']] as const} onChange={t => setF({ ...f, type: t })} /></div>
      <label className="field">日付<input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
      <label className="field">カテゴリ<select value={f.category_id} onChange={e => setF({ ...f, category_id: e.target.value })}>{tc.map(c => <option key={c.id} value={c.id}>{catIcon(c)} {c.name}</option>)}</select></label>
      <div className="field">金額<AmountInput value={f.amount} onChange={v => setF({ ...f, amount: v })} /></div>
      <label className="field">備考<input maxLength={200} value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} /></label>
      <div className="field">レシート画像({count}/{MAX_IMG})
        <div className="thumbs">
          {f.receipts.map((id: string) => <span className="thumb" key={id}><img src={`/api/receipts/${id}`} alt="レシート" />
            <button type="button" aria-label="画像を削除" onClick={() => ask('この画像を削除しますか?', { ok: '削除', danger: true }).then(ok => ok && delImg.mutate(id))}>×</button></span>)}
          {f.files.map((file: File, i: number) => <span className="thumb" key={i}><Preview file={file} />
            <button type="button" aria-label="追加を取り消す" onClick={() => setF({ ...f, files: f.files.filter((_: File, j: number) => j !== i) })}>×</button></span>)}
        </div>
        {count < MAX_IMG && <label className="btn sub filebtn">＋ 画像を追加
          <input className="sr-only" type="file" accept="image/*" multiple onChange={e => { const p = [...(e.target.files || [])]; setF({ ...f, files: [...f.files, ...p].slice(0, MAX_IMG - f.receipts.length) }); e.target.value = '' }} /></label>}
      </div>
      <div className="row end"><button className="sub" disabled={save.isPending} onClick={onClose}>キャンセル</button>
        <button disabled={save.isPending || f.amount === '' || !f.category_id} onClick={() => save.mutate()}>{save.isPending ? '保存中…' : '保存'}</button></div>
    </Modal>)
}
