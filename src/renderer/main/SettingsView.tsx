import { useEffect, useState } from 'react'
import { PROVIDERS, findProvider } from '../../shared/providers'
import { cleanIpcError } from './ipcError'
import { LANGUAGES, LOCAL_MODELS } from '../../shared/transcription'

type ModelInfo = { id: string; name: string; free: boolean; vision: boolean; contextTokens: number }

type Stt = Awaited<ReturnType<typeof window.miny.stt.get>>

// How Listen turns speech into text. Local Whisper is the default: no key, audio stays on this computer.
// OpenAI is optional; its key is saved here without changing the provider that answers questions.
function TranscriptionSettings() {
  const [stt, setStt] = useState<Stt | null>(null)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    void window.miny.stt.get().then(setStt)
    void window.miny.keys.has('openai').then(setHasKey)
  }, [])

  const update = async (patch: Partial<Stt>) => {
    if (!stt) return
    const saved = await window.miny.stt.set({ ...stt, ...patch })
    setStt(saved)
    setStatus('Transcription settings saved.')
  }

  if (!stt) return null

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Transcription (Listen)</h2>
      <label style={{ display: 'block' }}>
        <input type="radio" name="stt" checked={stt.provider === 'local'} onChange={() => update({ provider: 'local' })} /> Local
        Whisper (default): free, works offline, audio stays on this computer
      </label>
      <label style={{ display: 'block' }}>
        <input type="radio" name="stt" checked={stt.provider === 'openai'} onChange={() => update({ provider: 'openai' })} /> OpenAI:
        more accurate, needs an OpenAI key, sends audio to OpenAI
      </label>

      {stt.provider === 'local' ? (
        <div style={{ marginTop: 8 }}>
          <label>
            Whisper model{' '}
            <select aria-label="Whisper model" value={stt.localModel} onChange={(e) => update({ localModel: e.target.value as Stt['localModel'] })}>
              {LOCAL_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Language{' '}
            <select
              aria-label="Language"
              value={stt.language}
              onChange={(e) => update({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            Set the language people will speak: Whisper here doesn't detect it reliably. The model downloads once, the
            first time you start listening, then works offline.
          </p>
        </div>
      ) : (
        <OpenAiTranscriptionKey hasKey={hasKey} setHasKey={setHasKey} keyValue={key} setKey={setKey} setStatus={setStatus} />
      )}
      <p role="status">{status}</p>
    </div>
  )
}

function OpenAiTranscriptionKey(props: {
  hasKey: boolean
  setHasKey(v: boolean): void
  keyValue: string
  setKey(v: string): void
  setStatus(v: string): void
}) {
  const { hasKey, setHasKey, keyValue: key, setKey, setStatus } = props

  const save = async () => {
    if (!key.trim()) {
      setStatus('Enter an OpenAI key first.')
      return
    }
    try {
      await window.miny.keys.set('openai', key.trim())
      setKey('')
      setHasKey(true)
      setStatus('OpenAI key saved for transcription.')
    } catch (e) {
      setStatus(cleanIpcError(e))
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <input
        type="password"
        aria-label="OpenAI key for transcription"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={hasKey ? 'OpenAI key saved. Enter a new one to replace it.' : 'OpenAI API key'}
        style={{ width: '100%' }}
      />
      <button onClick={save}>Save transcription key</button>
    </div>
  )
}
type Active = { providerId: string; model: string }

export function SettingsView() {
  const [active, setActive] = useState<Active | null>(null)
  const [providerId, setProviderId] = useState(PROVIDERS[0].id)
  const [model, setModel] = useState(PROVIDERS[0].defaultModel)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [freeOnly, setFreeOnly] = useState(true)
  const [modelsNote, setModelsNote] = useState('')
  const [killed, setKilled] = useState(false)
  const [status, setStatus] = useState('')

  const p = findProvider(providerId) ?? PROVIDERS[0]

  const loadModels = async (id: string) => {
    setModels([])
    setModelsNote('')
    if (id !== 'openrouter') return
    setModelsNote('Loading the model list…')
    try {
      const list = await window.miny.models.list(id)
      setModels(list)
      setModelsNote(`${list.length} models available, ${list.filter((m) => m.free).length} free.`)
    } catch (e) {
      setModelsNote(`Could not load the model list: ${cleanIpcError(e)}`)
    }
  }

  // Show the saved (active) provider when the page opens.
  useEffect(() => {
    void window.miny.settings.get('llm.provider').then((v: any) => {
      if (v && findProvider(v.providerId)) {
        setActive({ providerId: v.providerId, model: v.model })
        setProviderId(v.providerId)
        setModel(v.model)
        void loadModels(v.providerId)
      }
    })
    void window.miny.settings.get('killswitch').then((v: any) => setKilled(!!v))
  }, [])

  useEffect(() => {
    setKey('')
    void window.miny.keys.has(providerId).then(setHasKey)
  }, [providerId])

  // A model name only makes sense for its own provider, so switching resets it to that provider's default.
  const changeProvider = (id: string) => {
    setProviderId(id)
    setModel(findProvider(id)?.defaultModel ?? '')
    setStatus('')
    void loadModels(id)
  }

  // One Save: stores the key (if typed) and makes this provider and model the active one.
  const save = async () => {
    const typedKey = key.trim()
    if (p.needsKey && !typedKey && !hasKey) {
      setStatus(`Enter your ${p.label} API key first.`)
      return
    }
    if (models.length && !models.some((m) => m.id === model.trim())) {
      setStatus(`"${model.trim()}" is not in the ${p.label} model list. Pick one from the list.`)
      return
    }
    try {
      if (typedKey) await window.miny.keys.set(p.id, typedKey)
      await window.miny.settings.set('llm.provider', { providerId: p.id, model })
      setKey('')
      setHasKey(p.needsKey ? true : hasKey)
      setActive({ providerId: p.id, model: model.trim() })
      setStatus(`Saved. miny now uses ${p.label} with ${model.trim()}.`)
    } catch (e) {
      setStatus(cleanIpcError(e))
    }
  }

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof window.miny.providers.test>> | null>(null)

  // Tests the provider in use (the saved one), showing the provider's exact error if any.
  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.miny.providers.test())
    } catch (e) {
      setTestResult({ ok: false, provider: '', model: '', error: cleanIpcError(e), keyInfo: null })
    } finally {
      setTesting(false)
    }
  }

  const shown = freeOnly ? models.filter((m) => m.free) : models
  const selected = models.find((m) => m.id === model.trim())
  const activeLabel = active ? `${findProvider(active.providerId)?.label ?? active.providerId} · ${active.model}` : 'OpenAI · gpt-4o-mini (default)'

  return (
    <div style={{ maxWidth: 560 }}>
      <p data-testid="active-provider">
        <strong>In use:</strong> {activeLabel}
      </p>

      <h2>Provider</h2>
      <select aria-label="Provider" value={providerId} onChange={(e) => changeProvider(e.target.value)}>
        {PROVIDERS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 8 }}>
        <input
          aria-label="Model"
          list="model-options"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model name"
          style={{ width: '100%' }}
        />
        <datalist id="model-options">
          {shown.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.vision ? ' (images)' : ''}
            </option>
          ))}
        </datalist>
        {models.length > 0 && (
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Show free models only
          </label>
        )}
        {modelsNote && <div style={{ fontSize: 13, opacity: 0.75 }}>{modelsNote}</div>}
        {selected && (
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            {selected.free ? 'Free model. ' : ''}
            {selected.vision ? 'Supports "Ask about screen".' : 'Text only: "Ask about screen" is not available with this model.'}
          </div>
        )}
      </div>

      {p.needsKey && (
        <div style={{ marginTop: 8 }}>
          <input
            type="password"
            aria-label="API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? `${p.label} key saved. Enter a new one to replace it.` : `${p.label} API key`}
            style={{ width: '100%' }}
          />
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <button onClick={save}>Save</button>{' '}
        <button onClick={testConnection} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>
      <p role="status">{status}</p>
      {testResult && (
        <div data-testid="test-result" style={{ fontSize: 14, color: testResult.ok ? '#1b5e20' : '#b00020' }}>
          {testResult.ok
            ? `Works: ${testResult.provider} · ${testResult.model} replied "${testResult.reply || '(empty)'}".`
            : `Failed: ${testResult.provider} · ${testResult.model}: ${testResult.error}`}
          {testResult.keyInfo && <div style={{ color: 'inherit', opacity: 0.85 }}>Key: {testResult.keyInfo}</div>}
        </div>
      )}

      <TranscriptionSettings />


      <h2 style={{ marginTop: 24 }}>Network kill switch</h2>
      <label>
        <input
          type="checkbox"
          checked={killed}
          onChange={async (e) => {
            setKilled(e.target.checked)
            await window.miny.killSwitch(e.target.checked)
          }}
        />{' '}
        Block all outbound provider requests
      </label>
    </div>
  )
}
