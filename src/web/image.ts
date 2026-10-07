// 端末側で圧縮(長辺1280px以内・WebP/JPEG)。canvasで再エンコードするのでEXIF(位置情報など)は残らない
const MAX_EDGE = 1280, MAX_BYTES = 1_000_000
export async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const enc = (t: string, q: number) => new Promise<Blob | null>(r => cv.toBlob(r, t, q))
  let blob = await enc('image/webp', 0.7)
  if (!blob || blob.type !== 'image/webp') blob = await enc('image/jpeg', 0.7)
  if (!blob) throw new Error('画像を変換できませんでした')
  for (let q = 0.6; blob.size > MAX_BYTES && q > 0.2; q -= 0.1) blob = (await enc(blob.type, q)) || blob
  if (blob.size > MAX_BYTES) throw new Error('画像が大きすぎます')
  return blob
}
export { toBase64 } from './offline/b64'
