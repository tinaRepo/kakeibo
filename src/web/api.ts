export { api } from './http'
export const yen = (n: number) => '¥' + n.toLocaleString('ja-JP')
export const onError = (e: Error) => alert(e.message)
const p2 = (n: number) => String(n).padStart(2, '0')
// 端末のローカル時間での今日(UTCだと、日本の0〜9時に前日になってしまう)
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
