import { BrowserWindow, globalShortcut, screen } from 'electron'

// The overlay is visible to the user and to screen captures. Do not enable
// Electron's content-protection API here: tests/main/overlay.test.ts pins that.
export function createOverlay(opts: { hotkey: string; preloadPath: string; load(win: BrowserWindow): void }) {
  const { width } = screen.getPrimaryDisplay().workAreaSize

  const win = new BrowserWindow({
    width: 420,
    height: 360,
    x: width - 440,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    focusable: false,
    webPreferences: { preload: opts.preloadPath, contextIsolation: true, sandbox: true }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  opts.load(win)

  // Local hotkey shows and hides the overlay on the user's own screen.
  globalShortcut.register(opts.hotkey, () => {
    if (win.isVisible()) win.hide()
    else win.showInactive()
  })

  return {
    window: win,
    show: () => win.showInactive(),
    hide: () => win.hide(),
    toggle: () => (win.isVisible() ? win.hide() : win.showInactive()),
    send: (channel: string, payload: unknown) => win.webContents.send(channel, payload)
  }
}
