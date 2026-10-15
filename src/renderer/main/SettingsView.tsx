import { useEffect, useState } from 'react'
import { PROVIDERS, findProvider } from '../../shared/providers'
import { cleanIpcError } from './ipcError'

export function SettingsView() {
  const [providerId, setProviderId] = useState('openai')
  const [model, setModel] = useState(PROVIDERS[0].defaultModel)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [killed, setKilled] = useState(false)
  const [status, setStatus] = useState('')

  const p = findProvider(providerId) ?? PROVIDERS[0]

  useEffect(() => {
    void window.miny.settings.get('llm.provider').then((v: any) => {
      if (v && findProvider(v.providerId)) {
        setProviderId(v.providerId)
        setModel(v.model)
      }
    })
    void window.miny.settings.get('killswitch').then((v: any) => setKilled(!!v))
  }, [])

  useEffect(() => {
    void window.miny.keys.has(providerId).then(setHasKey)
  }, [providerId])

  // A model name only makes sense for its own provider, so switching resets it to that provider's default.
  const changeProvider = (id: string) => {
    setProviderId(id)
    setModel(findProvider(id)?.defaultModel ?? '')
    setStatus('')
  }

  const saveProvider = async () => {
    try {
      await window.miny.settings.set('llm.provider', { providerId: p.id, model })
      setStatus('Provider saved')
    } catch (e) {
      setStatus(cleanIpcError(e))
    }
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
      setStatus(cleanIpcError(e))
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>Provider</h2>
      <select aria-label="Provider" value={providerId} onChange={(e) => changeProvider(e.target.value)}>
        {PROVIDERS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 8 }}>
        <input aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" style={{ width: '100%' }} />
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
      <p style={{ fontSize: 13, opacity: 0.75 }}>
        Listening (transcription) uses OpenAI, so it needs an OpenAI key even when answers come from another provider.
      </p>

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
