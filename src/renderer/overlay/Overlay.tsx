import { useEffect, useState, type CSSProperties } from 'react'

type Item = { id: string; question: string; answer: string; error?: string; partial?: boolean }

// The overlay shows the most recent items and keeps the last 5 questions.
export function Overlay() {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    return window.miny.onOverlayUpdate((item: Item) => {
      setItems((prev) => {
        const i = prev.findIndex((p) => p.id === item.id)
        // Updates for an answer already scrolled out are dropped, so old streams can't push newer ones out.
        if (i === -1) return item.partial ? prev : [...prev.slice(-4), item]
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
        fontFamily: 'system-ui',
        fontSize: 14,
        height: '100vh',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          WebkitAppRegion: 'drag',
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          opacity: 0.55,
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        } as CSSProperties}
      >
        miny overlay
      </div>
      <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
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
    </div>
  )
}
