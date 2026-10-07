import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, onError } from './api'
import { runSync } from './offline/sync'
import { Modal } from './ui'

// UTF-8を優先し、読めなければShift_JIS(Excelで保存したCSV)として読む
async function readText(f: File) {
  const buf = await f.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('shift_jis').decode(buf) }
}

export default function CsvImportPanel() {
  const qc = useQueryClient(), [prev, setPrev] = useState<{ text: string; r: any } | null>(null)
  const check = useMutation({ mutationFn: async (f: File) => { const text = await readText(f); return { text, r: await api('/import/csv', 'POST', { csv: text, dry_run: true }) } }, onSuccess: setPrev, onError })
  const run = useMutation({
    mutationFn: () => api('/import/csv', 'POST', { csv: prev!.text }),
    onSuccess: (r: any) => { setPrev(null); ['tx', 'summary', 'categories'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); runSync(qc); alert(`取り込みました(追加 ${r.imported}件・更新 ${r.updated}件)`) }, onError,
  })
  const r = prev?.r
  return (
    <div className="panel"><b>CSVの取り込み</b>
      <p className="mute">設定の「CSVを書き出す」と同じ形式のファイルを取り込めます(見出し: 日付・種別・カテゴリ・金額・備考)。「明細ID」が同じ家計簿の明細と一致すると更新、なければ追加します。入力者は取り込んだあなたになります(入力者IDがこの家計簿のメンバーなら、そのメンバー)。</p>
      <label className="btn sub filebtn">CSVファイルを選ぶ<input className="sr-only" type="file" accept=".csv,text/csv" disabled={check.isPending} onChange={e => { const f = e.target.files?.[0]; if (f) check.mutate(f); e.target.value = '' }} /></label>
      {prev && <Modal title="取り込み内容の確認" onClose={() => setPrev(null)}>
        <p>追加 <b>{r.imported}</b>件・更新 <b>{r.updated}</b>件{r.new_categories.length > 0 && <>・新しいカテゴリ: {r.new_categories.join('、')}</>}</p>
        {r.error_count > 0 && <><p>修正が必要な行が <b>{r.error_count}</b> 件あります。</p>
          <div className="scroll" style={{ maxHeight: 200 }}>{r.errors.map((e: any) => <p className="mute" key={e.line}>{e.line}行目: {e.msg}</p>)}</div></>}
        <div className="row end"><button className="sub" onClick={() => setPrev(null)}>キャンセル</button>
          <button disabled={run.isPending || r.error_count > 0 || r.imported + r.updated === 0} onClick={() => run.mutate()}>{run.isPending ? '取り込み中…' : '取り込む'}</button></div>
      </Modal>}
    </div>)
}
