import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Modal } from './ui'

// カメラでQRコードを読み取る(iOSのPWAでも動くようにjsQRで解析)
export default function Scanner({ onCode, onClose }: { onCode: (c: string) => void; onClose: () => void }) {
  const v = useRef<HTMLVideoElement>(null), [err, setErr] = useState('')
  useEffect(() => {
    let stop = false, stream: MediaStream | undefined
    const cv = document.createElement('canvas')
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const el = v.current!
        el.srcObject = stream; await el.play()
        const tick = () => {
          if (stop) return
          if (el.videoWidth) {
            cv.width = el.videoWidth; cv.height = el.videoHeight
            const g = cv.getContext('2d', { willReadFrequently: true })!
            g.drawImage(el, 0, 0)
            const d = g.getImageData(0, 0, cv.width, cv.height), r = jsQR(d.data, d.width, d.height)
            if (r?.data) { onCode(r.data); return }
          }
          requestAnimationFrame(tick)
        }
        tick()
      } catch { setErr('カメラを使えません。コードを入力してください。') }
    })()
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return (
    <Modal title="QRコードを読み取る" onClose={onClose}>
      <video ref={v} playsInline muted style={{ width: '100%', borderRadius: 11, background: '#000' }} />
      {err ? <p className="mute">{err}</p> : <p className="mute">別の端末に表示されたQRコードをかざしてください。</p>}
      <div className="row end"><button className="sub" onClick={onClose}>閉じる</button></div>
    </Modal>)
}
