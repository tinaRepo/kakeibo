import { useEffect, useState } from 'react'
import { Modal } from './ui'

// 新しいバージョンがあるとき、画面と同じデザインのモーダルで確認する
let show: ((f: (() => void) | null) => void) | null = null
let waiting: (() => void) | null = null
export const offerUpdate = (apply: () => void) => { waiting = apply; show?.(apply) }

export function UpdatePrompt() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  useEffect(() => { show = f => setApply(() => f); if (waiting) setApply(() => waiting); return () => { show = null } }, [])
  if (!apply) return null
  return (
    <Modal title="新しいバージョンがあります" onClose={() => setApply(null)}>
      <p>更新しますか?(入力中の内容は端末に保存されます)</p>
      <div className="row end"><button className="sub" onClick={() => setApply(null)}>あとで</button><button onClick={() => apply()}>更新する</button></div>
    </Modal>)
}
