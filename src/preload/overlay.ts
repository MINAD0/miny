import { contextBridge, ipcRenderer } from 'electron'

// The overlay only displays answers, so it gets a receive-only bridge:
// no access to notes, settings, keys, or any other IPC channel.
contextBridge.exposeInMainWorld('miny', {
  onOverlayUpdate: (cb: (item: any) => void): (() => void) => {
    const handler = (_: unknown, item: unknown) => cb(item)
    ipcRenderer.on('overlay:update', handler)
    return () => {
      ipcRenderer.off('overlay:update', handler)
    }
  }
})
