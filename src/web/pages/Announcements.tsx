import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { fmt } from '../Thread'

export default function Announcements() {
  const qc = useQueryClient(), [open, setOpen] = useState<number | null>(null)
  const { data = [] } = useQuery<any[]>({ queryKey: ['ann'], queryFn: () => api('/announcements') })
  const read = useMutation({ mutationFn: (id: number) => api(`/announcements/${id}/read`, 'POST', {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ['ann'] }); qc.invalidateQueries({ queryKey: ['unread'] }) } })
  return (
    <main><h1>お知らせ</h1>
      {data.length === 0 && <p className="mute">お知らせはありません。</p>}
      {data.map(a => (
        <div className="panel" key={a.id}>
          <button className="sub" style={{ border: 0, padding: 0, background: 'none', color: 'inherit', textAlign: 'left', width: '100%', display: 'block' }}
            onClick={() => { setOpen(open === a.id ? null : a.id); if (!a.read) read.mutate(a.id) }} aria-expanded={open === a.id}>
            {!a.read && <span className="badge">新着</span>} <b>{a.title}</b><div className="mute">{fmt(a.publish_at)}</div></button>
          {open === a.id && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{a.body}</p>}
        </div>))}
    </main>)
}
