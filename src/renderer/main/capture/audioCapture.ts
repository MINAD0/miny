export type CaptureHandle = { stop(): Promise<void> }

const CHUNK_MS = 5000

// Records microphone plus system audio, mixed into one stream, in 5-second chunks.
// Each chunk comes from a fresh MediaRecorder, so every chunk is a complete WebM file
// with its own header. (With a single recorder and a timeslice, later chunks are
// continuation data that a transcription API can't decode on their own.)
// Calls onDeviceLost if any input track ends mid-session.
export async function startCapture(opts: {
  onChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<unknown> | void
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
  const t0 = performance.now()
  let running = true
  let current: MediaRecorder | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  // Chunk uploads run in the background so recording never pauses while a chunk is transcribed.
  const pending: Promise<unknown>[] = []

  const recordOne = () =>
    new Promise<void>((resolve) => {
      const r = new MediaRecorder(dest.stream, { mimeType: mime })
      current = r
      const parts: Blob[] = []
      const startMs = performance.now() - t0
      r.ondataavailable = (e) => {
        if (e.data.size) parts.push(e.data)
      }
      r.onstop = async () => {
        const endMs = performance.now() - t0
        if (parts.length) {
          const bytes = new Uint8Array(await new Blob(parts, { type: mime }).arrayBuffer())
          pending.push(Promise.resolve(opts.onChunk(bytes, mime, startMs, endMs)).catch(() => undefined))
        }
        resolve()
      }
      r.start()
      timer = setTimeout(() => {
        if (r.state !== 'inactive') r.stop()
      }, CHUNK_MS)
    })

  const loop = (async () => {
    while (running) await recordOne()
  })()

  let lost = false
  const deviceEnded = () => {
    if (lost) return
    lost = true
    opts.onDeviceLost()
  }
  mic.getAudioTracks().forEach((t) => t.addEventListener('ended', deviceEnded))
  sysTracks.forEach((t) => t.addEventListener('ended', deviceEnded))

  return {
    // Resolves after the final partial chunk is flushed and every chunk upload has finished.
    async stop() {
      running = false
      clearTimeout(timer)
      const r = current as MediaRecorder | null
      if (r && r.state !== 'inactive') r.stop()
      await loop
      await Promise.allSettled(pending)
      mic.getTracks().forEach((t) => t.stop())
      display.getTracks().forEach((t) => t.stop())
      await ctx.close()
    }
  }
}
