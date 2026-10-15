import { useEffect, useRef, useState } from 'react'
import { NotesView } from './NotesView'
import { SettingsView } from './SettingsView'
import { ActivityView } from './ActivityView'
import { startCapture, CaptureHandle } from './capture/audioCapture'

type Tab = 'listen' | 'notes' | 'settings' | 'activity'

export function App() {
  const [tab, setTab] = useState<Tab>('listen')
  return (
    <div style={{ fontFamily: 'system-ui', display: 'flex', height: '100vh' }}>
      <nav style={{ width: 160, padding: 12, borderRight: '1px solid #ddd' }}>
        {(['listen', 'notes', 'settings', 'activity'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ display: 'block', width: '100%', marginBottom: 6 }}>
            {t}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {tab === 'listen' && <ListenView />}
        {tab === 'notes' && <NotesView />}
        {tab === 'settings' && <SettingsView />}
        {tab === 'activity' && <ActivityView />}
      </main>
    </div>
  )
}

// Manual Ask and Vision. Answers stream into the overlay.
function AskBox() {
  const [question, setQuestion] = useState('')
  const [useContext, setUseContext] = useState(true)
  const [error, setError] = useState('')

  const run = async (kind: 'ask' | 'vision') => {
    const q = question.trim()
    if (!q) {
      setError('Type a question first')
      return
    }
    setError('')
    try {
      if (kind === 'ask') await window.miny.ask(q, useContext)
      else await window.miny.vision(q)
      setQuestion('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <input
        placeholder="Ask a question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run('ask')}
        style={{ width: '60%' }}
      />{' '}
      <button onClick={() => run('ask')}>Ask</button>{' '}
      <button onClick={() => run('vision')}>Ask about screen</button>{' '}
      <label>
        <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} /> Use transcript
      </label>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
    </div>
  )
}

function ListenView() {
  const [live, setLive] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const handle = useRef<CaptureHandle | null>(null)

  useEffect(() => window.miny.listen.onSegment((seg) => setLines((prev) => [...prev, seg.text])), [])

  const stop = async (reason: 'user' | 'device_lost') => {
    const h = handle.current
    handle.current = null
    setLive(false)
    // Flush the final partial chunk and wait for uploads before the session is saved.
    await h?.stop()
    const result = await window.miny.listen.stop()
    if (reason === 'device_lost') setError('The audio device was lost. The transcript so far is saved as a note.')
    return result
  }

  const start = async () => {
    setError('')
    try {
      await window.miny.listen.start()
      handle.current = await startCapture({
        onChunk: (bytes, mime, s, e) => window.miny.listen.chunk(bytes, mime, s, e),
        onDeviceLost: () => void stop('device_lost')
      })
      setLines([])
      setLive(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <h2>Listen</h2>
      <button onClick={() => (live ? stop('user') : start())}>{live ? 'Stop' : 'Start listening'}</button>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      <AskBox />
      <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
        {lines.length === 0 ? 'Transcript appears here while listening.' : lines.join('\n')}
      </div>
    </div>
  )
}
