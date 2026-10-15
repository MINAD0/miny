export type CaptureHandle = { stop(): void }

const CHUNK_MS = 5000

// Records microphone plus system audio, mixed into one stream, in 5-second chunks.
// Calls onDeviceLost if any input track ends mid-session.
export async function startCapture(opts: {
  onChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): void
  onDeviceLost(): void
}): Promise<CaptureHandle> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  const sysTracks = display.getAudioTracks()
  display.getVideoTracks().forEach((t) => t.stop())

  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  ctx.createMediaStreamSource(mic).connect(dest)
  if (sysTracks.length) ctx.createMediaStreamSource(new MediaStream(sysTracks)).connect(dest)

  const mime = 'audio/webm;codecs=opus'
  const recorder = new MediaRecorder(dest.stream, { mimeType: mime })
  const started = performance.now()
  let lastStart = 0

  recorder.ondataavailable = async (e) => {
    if (!e.data.size) return
    const now = performance.now() - started
    const bytes = new Uint8Array(await e.data.arrayBuffer())
    opts.onChunk(bytes, mime, lastStart, now)
    lastStart = now
  }

  let lost = false
  const deviceEnded = () => {
    if (lost) return
    lost = true
    opts.onDeviceLost()
  }
  mic.getAudioTracks().forEach((t) => t.addEventListener('ended', deviceEnded))
  sysTracks.forEach((t) => t.addEventListener('ended', deviceEnded))

  recorder.start(CHUNK_MS)

  return {
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      mic.getTracks().forEach((t) => t.stop())
      display.getTracks().forEach((t) => t.stop())
      void ctx.close()
    }
  }
}
