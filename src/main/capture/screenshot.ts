import { desktopCapturer, screen } from 'electron'

// Electron-only: captures the primary screen as a base64 PNG for Vision.
export async function captureScreenPng(): Promise<string> {
  const { width, height } = screen.getPrimaryDisplay().size
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
  if (!sources.length) throw new Error('No screen source available')
  return sources[0].thumbnail.toPNG().toString('base64')
}
