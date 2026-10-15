import { useEffect, useRef, useState } from 'react'
import { NotesView } from './NotesView'
import { SettingsView } from './SettingsView'
import { ActivityView } from './ActivityView'
import { startCapture, CaptureHandle } from './capture/audioCapture'
import { cleanIpcError } from './ipcError'

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
        {/* Listen stays mounted while hidden, so switching tabs never orphans a running capture. */}
        <div style={{ display: tab === 'listen' ? 'block' : 'none' }}>
          <ListenView />
        </div>
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
      setError(cleanIpcError(e))
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

type Phase = 'idle' | 'starting' | 'live' | 'stopping'
type Seg = { t_start: number; t_end: number; text: string }

function ListenView() {
  const [phase, setPhaseState] = useState<Phase>('idle')
  const phaseRef = useRef<Phase>('idle')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [segments, setSegments] = useState<Seg[]>([])
  const [error, setError] = useState('')
  const handle = useRef<CaptureHandle | null>(null)

  // Keep lines in time order; chunks can finish transcribing out of order.
  useEffect(
    () =>
      window.miny.listen.onSegment((seg) =>
        setSegments((prev) => [...prev, seg].sort((a, b) => a.t_start - b.t_start))
      ),
    []
  )

  const stop = async (reason: 'user' | 'device_lost') => {
    if (phaseRef.current !== 'live') return // ignore a second stop, or a stop while starting
    setPhase('stopping')
    try {
      // Flush the final partial chunk and wait for uploads before the session is saved.
      await handle.current?.stop()
      handle.current = null
      const { sessionId } = await window.miny.listen.stop()
      if (reason === 'device_lost') {
        setError(
          sessionId === null
            ? 'The audio device was lost. Nothing was transcribed, so no note was saved.'
            : 'The audio device was lost. The transcript so far is saved as a note.'
        )
      }
    } catch (e) {
      setError(cleanIpcError(e))
    } finally {
      setPhase('idle')
    }
  }

  const start = async () => {
    if (phaseRef.current !== 'idle') return
    setPhase('starting')
    setError('')
    try {
      await window.miny.listen.start()
    } catch (e) {
      setError(cleanIpcError(e))
      setPhase('idle')
      return
    }
    try {
      handle.current = await startCapture({
        onChunk: (bytes, mime, s, e) => window.miny.listen.chunk(bytes, mime, s, e),
        onDeviceLost: () => void stop('device_lost')
      })
      setSegments([])
      setPhase('live')
    } catch (e) {
      // Capture failed (e.g. no permission): end the session the main process started.
      await window.miny.listen.stop().catch(() => undefined)
      setError(`Could not start audio capture: ${cleanIpcError(e)}`)
      setPhase('idle')
    }
  }

  const label = { idle: 'Start listening', starting: 'Starting…', live: 'Stop', stopping: 'Saving…' }[phase]

  return (
    <div>
      <h2>Listen</h2>
      <button
        disabled={phase === 'starting' || phase === 'stopping'}
        onClick={() => (phase === 'live' ? stop('user') : start())}
      >
        {label}
      </button>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      <AskBox />
      <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
        {segments.length === 0 ? 'Transcript appears here while listening.' : segments.map((s) => s.text).join('\n')}
      </div>
    </div>
  )
}
