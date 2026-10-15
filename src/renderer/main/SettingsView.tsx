import { useEffect, useState } from 'react'

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', needsKey: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic (Claude)', needsKey: true, baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
  {
    id: 'openrouter',
    label: 'OpenRouter (includes free models)',
    needsKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free'
  },
  { id: 'ollama', label: 'Ollama (local)', needsKey: false, baseUrl: 'http://localhost:11434/v1', model: 'llama3' }
]

export function SettingsView() {
  const [providerId, setProviderId] = useState('openai')
  const [model, setModel] = useState('gpt-4o-mini')
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [killed, setKilled] = useState(false)
  const [status, setStatus] = useState('')

  const p = PROVIDERS.find((x) => x.id === providerId)!

  useEffect(() => {
    void window.miny.settings.get('llm.provider').then((v: any) => {
      if (v) {
        setProviderId(v.providerId)
        setModel(v.model)
      }
    })
    void window.miny.settings.get('killswitch').then((v: any) => setKilled(!!v))
  }, [])

  useEffect(() => {
    void window.miny.keys.has(providerId).then(setHasKey)
  }, [providerId])

  const saveProvider = async () => {
    if (!model.trim()) {
      setStatus('Enter a model name')
      return
    }
    await window.miny.settings.set('llm.provider', { providerId: p.id, model: model.trim(), needsKey: p.needsKey, baseUrl: p.baseUrl })
    setStatus('Provider saved')
  }

  const saveKey = async () => {
    if (!key.trim()) {
      setStatus('Enter a key first')
      return
    }
    try {
      await window.miny.keys.set(p.id, key.trim())
      setKey('')
      setHasKey(true)
      setStatus('Key saved, encrypted by Windows')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>Provider</h2>
      <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
        {PROVIDERS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 8 }}>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" style={{ width: '100%' }} />
      </div>
      {p.needsKey && (
        <div style={{ marginTop: 8 }}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? 'Key saved. Enter a new one to replace it.' : 'API key'}
            style={{ width: '100%' }}
          />
          <button onClick={saveKey}>Save key</button>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button onClick={saveProvider}>Save provider</button>
      </div>

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

      <p>{status}</p>
    </div>
  )
}
