import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, onError } from '../api'
import { useCats, useMe, useOnline, usePending, useSyncErrors } from '../hooks'
import { discardError, resendError } from '../offline/local'
import { runSync } from '../offline/sync'
import { Modal, catIcon, useConfirm } from '../ui'
import HandoffPanel from '../Handoff'
import Notifications from '../Notifications'
import CredentialsPanel from '../Credentials'
import CsvImportPanel from '../CsvImport'
import { clearLocal } from '../offline/db'

const PRESETS = ['🍽️', '🍚', '☕', '🛒', '🧴', '🚃', '🚗', '⛽', '💡', '🚿', '📱', '🌐', '🏠', '🔧', '💊', '🏥', '🥂', '🎁', '🎮', '🎬', '👕', '💄', '📚', '🎓', '🐶', '👶', '✈️', '🧾', '💴', '💼', '🏦', '📈', '💰', '📦']
const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB'

export default function Settings() {
  const me = useMe().data!, qc = useQueryClient(), { data: cats = [] } = useCats(), ask = useConfirm()
  const online = useOnline(), pending = usePending(), errs = useSyncErrors()
  const [name, setName] = useState(me.name || ''), [code, setCode] = useState(''), [year, setYear] = useState(new Date().getFullYear())
  const [cat, setCat] = useState({ type: 'expense', name: '', icon: '' }), [edit, setEdit] = useState<any>(null)
  useEffect(() => setName(me.name || ''), [me.name])
  const { data: sessions = [] } = useQuery<any[]>({ queryKey: ['sessions'], queryFn: () => api('/me/sessions') })
  const { data: usage } = useQuery<{ used: number; limit: number }>({ queryKey: ['usage'], queryFn: () => api('/receipts/usage') })
  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k] })
  const rename = useMutation({ mutationFn: () => api('/me', 'PUT', { name }), onSuccess: () => inv('me'), onError })
  const out = useMutation({ mutationFn: (id: string) => api('/me/sessions/' + id, 'DELETE'), onSuccess: () => inv('sessions'), onError })
  const reissue = useMutation({ mutationFn: () => api('/me/owner-code', 'POST', {}), onSuccess: (r: any) => setCode(r.code), onError })
  const addCat = useMutation({ mutationFn: () => api('/categories', 'POST', cat), onSuccess: () => { setCat({ ...cat, name: '', icon: '' }); inv('categories') }, onError })
  const upCat = useMutation({ mutationFn: (c: any) => api('/categories/' + c.id, 'PUT', { name: c.name, icon: c.icon, is_active: c.is_active }), onSuccess: () => { setEdit(null); inv('categories') }, onError })
  const move = useMutation({ mutationFn: (v: { type: string; ids: number[] }) => api('/category-order', 'PUT', v), onSuccess: () => inv('categories'), onError })
  const swap = (a: number[], i: number, j: number) => { const b = [...a];[b[i], b[j]] = [b[j], b[i]]; return b }
  const del = useMutation({ mutationFn: () => api('/ledger', 'DELETE', {}), onSuccess: () => clearLocal().then(() => qc.resetQueries()), onError })
  const pct = usage ? (usage.used / usage.limit) * 100 : 0
  return (
    <main><h1>設定</h1>
      <div className="panel"><b>表示名</b><div className="row"><input value={name} onChange={e => setName(e.target.value)} /><button disabled={!name.trim()} onClick={() => rename.mutate()}>保存</button></div></div>
      <CredentialsPanel />
      {me.role === 'owner' && <div className="panel"><b>オーナー</b>
        <div className="row"><Link className="btn sub" to="/settings/members">メンバー管理</Link>
          <button className="sub" onClick={() => ask('古いオーナーコードは使えなくなります。新しいコードを発行しますか?', { ok: '発行' }).then(ok => ok && reissue.mutate())}>オーナーコードを発行</button></div>
        {code && <><code className="code">{code}</code><p className="mute">再表示できません。別の端末で復元するために必ず控えてください。</p></>}
        <div className="row"><input type="number" style={{ width: 120 }} aria-label="年" value={year} onChange={e => setYear(+e.target.value)} /><a className="btn sub" href={`/api/export/csv?year=${year}`}>CSVを書き出す</a></div>
        <p className="mute">登録時にはオーナーコードを表示していません。他の端末でも使えるよう、早めに発行して控えてください。</p></div>}
      <Notifications />
      <HandoffPanel />
      <div className="panel"><b>オフライン状態</b>
        <p>{online ? 'オンライン' : 'オフライン'}・未同期 {pending}件</p>
        <button className="sub" disabled={!online} onClick={() => runSync(qc)}>今すぐ同期</button>
        {errs.map(e => <div className="item" key={e.id}><div>{e.kind === 'delete' ? '削除' : e.kind === 'image' ? '画像の添付' : '保存'}に失敗: {e.error}<div className="mute">{e.at.slice(0, 16).replace('T', ' ')}</div></div>
          <div>{e.kind !== 'image' && <button className="sub sm" onClick={() => resendError(e, me.id).then(() => runSync(qc))}>再送</button>}<button className="sub sm" onClick={() => discardError(e.id).then(() => inv('tx'))}>破棄</button></div></div>)}</div>
      {me.role === 'owner' && <CsvImportPanel />}
      {usage && <div className="panel"><b>レシート画像の使用量</b><p>{mb(usage.used)} / {mb(usage.limit)}</p>
        {pct >= 80 && <p className="mute">上限の80%を超えました。古い画像を削除して容量を空けてください。</p>}</div>}
      {me.perms.category && <div className="panel"><b>カテゴリ</b>
        <div className="row"><select aria-label="種別" value={cat.type} onChange={e => setCat({ ...cat, type: e.target.value })}><option value="expense">支出</option><option value="income">収入</option></select>
          <input className="icon-in" aria-label="アイコン" placeholder="🏷️" value={cat.icon} onChange={e => setCat({ ...cat, icon: e.target.value })} />
          <input placeholder="カテゴリ名" value={cat.name} onChange={e => setCat({ ...cat, name: e.target.value })} /><button disabled={!cat.name.trim()} onClick={() => addCat.mutate()}>追加</button></div>
        <p className="mute">▲▼で並び順を入れ替えられます。明細の入力や集計の表示順にも反映されます。</p>
        {(['expense', 'income'] as const).map(t => {
          const list = cats.filter(c => c.type === t); return (
            <div key={t}><div className="day">{t === 'expense' ? '支出' : '収入'}</div>
              {list.map((c, i) => <div className="item" key={c.id}><span style={{ opacity: c.is_active ? 1 : .4 }}>{catIcon(c)}　{c.name}</span>
                <div style={{ whiteSpace: 'nowrap' }}>
                  <button className="mv" aria-label={`${c.name}を上へ`} disabled={i === 0 || move.isPending} onClick={() => move.mutate({ type: t, ids: swap(list.map(x => x.id), i, i - 1) })}>▲</button>
                  <button className="mv" aria-label={`${c.name}を下へ`} disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate({ type: t, ids: swap(list.map(x => x.id), i, i + 1) })}>▼</button>
                  <button className="sub sm" style={{ marginLeft: 8 }} onClick={() => setEdit({ ...c })}>編集</button></div></div>)}</div>)
        })}</div>}
      <div className="panel"><b>ログイン中の端末</b>
        {sessions.map(s => <div className="item" key={s.id}><div>{s.device_label || '不明な端末'}{s.current && ' (この端末)'}<div className="mute">最終利用 {s.last_used_at.slice(0, 10)}</div></div>
          {!s.current && <button className="sub sm" onClick={() => out.mutate(s.id)}>ログアウト</button>}</div>)}</div>
      <div className="panel"><b>そのほか</b>
        <div className="row">{me.role === 'owner' && <Link className="btn sub" to="/recovery">以前の家計簿の引き継ぎを申請</Link>}<a className="btn sub" href="/terms">規約・プライバシー</a></div>
        {me.role === 'owner' && <div className="row"><button className="danger" onClick={() => ask('家計簿のすべてのデータ(明細・画像・メンバー)を削除します。元に戻せません。', { ok: '次へ', danger: true }).then(ok => ok && ask('本当に削除しますか?', { ok: '完全に削除する', danger: true })).then(ok => ok && del.mutate())}>家計簿を削除</button></div>}</div>
      {edit && <Modal title="カテゴリを編集" onClose={() => setEdit(null)}>
        <div className="field">アイコン(絵文字を自由に入力、または下から選択)
          <input className="icon-in" aria-label="アイコン" value={edit.icon || ''} onChange={e => setEdit({ ...edit, icon: e.target.value })} />
          <div className="presets">{PRESETS.map(p => <button key={p} type="button" aria-label={`アイコン ${p}`} onClick={() => setEdit({ ...edit, icon: p })}>{p}</button>)}</div></div>
        <label className="field">名前<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={!!edit.is_active} onChange={e => setEdit({ ...edit, is_active: e.target.checked ? 1 : 0 })} />有効にする</label>
        <div className="row end"><button className="sub" onClick={() => setEdit(null)}>キャンセル</button><button disabled={!edit.name.trim()} onClick={() => upCat.mutate(edit)}>保存</button></div>
      </Modal>}
    </main>)
}
