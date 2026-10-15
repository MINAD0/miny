import { useEffect, useState } from 'react'

type Item = { id: string; question: string; answer: string; error?: string; partial?: boolean }

// The overlay shows the most recent items and keeps the last 5 questions.
export function Overlay() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    return window.miny.onOverlayUpdate((item: Item) => {
      setItems((prev) => {
        const i = prev.findIndex((p) => p.id === item.id)
        if (i === -1) return [...prev.slice(-4), item]
        const copy = [...prev]
        copy[i] = item
        return copy
      })
    })
  }, [])

  return (
    <div
      style={{
        background: 'rgba(20,20,20,0.82)',
        color: '#fff',
        borderRadius: 12,
        padding: 12,
        fontFamily: 'system-ui',
        fontSize: 14,
        height: '100vh',
        boxSizing: 'border-box',
        overflow: 'auto'
      }}
    >
      {items.length === 0 && <div style={{ opacity: 0.6 }}>Listening. Questions and answers appear here.</div>}
      {items.map((it) => (
        <div key={it.id} style={{ marginBottom: 12 }}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>{it.question}</div>
          {it.error ? (
            <div style={{ color: '#ffb4b4' }}>{it.error}</div>
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{it.answer || '…'}</div>
          )}
        </div>
      ))}
    </div>
  )
}
