export const KIND: Record<string, string> = { question: '問い合わせ', request: '要望', bug: '不具合', recovery: '引き継ぎ申請' }
export const STATUS: Record<string, string> = { open: '受付', replied: '返信済み', closed: '完了' }
export const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export function Thread({ msgs, me }: { msgs: any[]; me: 'member' | 'admin' }) {
  return <div>{msgs.map(m => (
    <div key={m.id} className={'bubble' + (m.sender === me ? ' mine' : '')}>
      <div>{m.body}</div><div className="mute">{m.sender === 'admin' ? '管理者' : 'ユーザー'}・{fmt(m.created_at)}</div>
    </div>))}</div>
}
