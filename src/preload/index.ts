import { contextBridge, ipcRenderer } from 'electron'

type ListFilter = { folder_id?: number | null; favorite?: boolean; archived?: boolean; tag?: string }

const subscribe = (channel: string, cb: (payload: any) => void): (() => void) => {
  const handler = (_: unknown, payload: unknown) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api = {
  notes: {
    create: (input: { title?: string; body_md?: string; folder_id?: number | null }) => ipcRenderer.invoke('notes:create', input),
    update: (id: number, patch: Record<string, unknown>) => ipcRenderer.invoke('notes:update', id, patch),
    get: (id: number) => ipcRenderer.invoke('notes:get', id),
    list: (filter?: ListFilter) => ipcRenderer.invoke('notes:list', filter ?? {}),
    search: (q: string) => ipcRenderer.invoke('notes:search', q),
    tags: (id: number) => ipcRenderer.invoke('notes:tags', id),
    setTags: (id: number, tags: string[]) => ipcRenderer.invoke('notes:setTags', id, tags),
    export: (id: number) => ipcRenderer.invoke('notes:export', id)
  },
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    create: (name: string) => ipcRenderer.invoke('folders:create', name)
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  providers: {
    test: (): Promise<{
      ok: boolean
      provider: string
      model: string
      answeredBy: string | null
      reply?: string
      error?: string
      keyInfo: string | null
    }> => ipcRenderer.invoke('providers:test')
  },
  models: {
    list: (
      providerId: string
    ): Promise<{ id: string; name: string; free: boolean; vision: boolean; contextTokens: number }[]> =>
      ipcRenderer.invoke('models:list', providerId)
  },
  keys: {
    set: (providerId: string, key: string) => ipcRenderer.invoke('keys:set', providerId, key),
    has: (providerId: string) => ipcRenderer.invoke('keys:has', providerId)
  },
  stt: {
    get: (): Promise<{ provider: 'local' | 'openai'; localModel: 'tiny' | 'base' | 'small'; language: string }> =>
      ipcRenderer.invoke('stt:get'),
    set: (value: unknown) => ipcRenderer.invoke('stt:set', value)
  },
  listen: {
    start: (): Promise<{
      provider: 'local' | 'openai'
      localModel: 'tiny' | 'base' | 'small'
      language: string
      killSwitch: boolean
    }> => ipcRenderer.invoke('listen:start'),
    text: (text: string, startMs: number, endMs: number) => ipcRenderer.invoke('listen:text', text, startMs, endMs),
    stop: () => ipcRenderer.invoke('listen:stop'),
    chunk: (bytes: Uint8Array, mime: string, startMs: number, endMs: number) =>
      ipcRenderer.invoke('listen:chunk', bytes, mime, startMs, endMs),
    onSegment: (cb: (seg: { t_start: number; t_end: number; text: string }) => void) => subscribe('listen:segment', cb),
    onDeviceLost: (cb: () => void) => subscribe('listen:deviceLost', cb)
  },
  ask: (question: string, useContext: boolean) => ipcRenderer.invoke('ask:send', question, useContext),
  vision: (question: string) => ipcRenderer.invoke('ask:vision', question),
  tracking: {
    setConsent: (granted: boolean) => ipcRenderer.invoke('tracking:consent', granted),
    log: () => ipcRenderer.invoke('tracking:log'),
    wipe: () => ipcRenderer.invoke('tracking:wipe')
  },
  killSwitch: (on: boolean) => ipcRenderer.invoke('killswitch:set', on),
  onOverlayUpdate: (cb: (item: any) => void) => subscribe('overlay:update', cb)
}

contextBridge.exposeInMainWorld('miny', api)
export type MinyApi = typeof api
