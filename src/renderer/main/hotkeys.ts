export type HotkeyName = 'toggleListen' | 'focusAsk' | 'vision'

const handlers: Record<HotkeyName, Set<() => void>> = {
  toggleListen: new Set(),
  focusAsk: new Set(),
  vision: new Set()
}

// The main process only sends the action name; each mounted view decides what it means.
if (typeof window !== 'undefined' && window.miny?.onHotkey) {
  window.miny.onHotkey((name) => {
    for (const fn of handlers[name] ?? []) fn()
  })
}

export function onHotkey(name: HotkeyName, fn: () => void): () => void {
  handlers[name].add(fn)
  return () => {
    handlers[name].delete(fn)
  }
}
