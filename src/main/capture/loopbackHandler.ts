import { desktopCapturer, session } from 'electron'

// Lets the renderer's getDisplayMedia() return system audio (WASAPI loopback on Windows).
// The video track is discarded by the renderer; only the audio is used.
export function installLoopbackHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (!sources.length) {
      callback({})
      return
    }
    callback({ video: sources[0], audio: 'loopback' })
  })
}
