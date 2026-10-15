import { useEffect, useState } from 'react'

type Entry = { name: string; props: Record<string, unknown>; created_at: number }

export function ActivityView() {
  const [consent, setConsent] = useState<boolean | null>(null)
  const [log, setLog] = useState<Entry[]>([])

  useEffect(() => {
    void window.miny.settings.get('tracking.consent').then((v: any) => setConsent(v === true))
    void window.miny.tracking.log().then(setLog)
  }, [])

  const grant = async (on: boolean) => {
    await window.miny.tracking.setConsent(on)
    setConsent(on)
  }

  return (
    <div>
      <h2>Activity log</h2>
      {consent === false && (
        <div>
          <p>Miny can record usage events on this device and show them here. Nothing is recorded until you allow it.</p>
          <button onClick={() => grant(true)}>Allow recording</button>
        </div>
      )}
      {consent && (
        <>
          <button
            onClick={async () => {
              await window.miny.tracking.wipe()
              setConsent(false)
              setLog([])
            }}
          >
            Turn off and delete history
          </button>
          <ul>
            {log.map((e, i) => (
              <li key={i}>
                {new Date(e.created_at).toLocaleString()}: {e.name} {JSON.stringify(e.props)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
