import { cleanTranscript, decodeTo16kMono, rms, SILENCE_RMS } from './audio'

export type WhisperModel = 'tiny' | 'base' | 'small'
export type LoadProgress = { file: string; loaded: number; total: number }

// One background worker for the whole app. Loading a model downloads it once
// (then it is cached) and keeps it in memory for the session.
let worker: Worker | null = null
let readyModel: string | null = null
let nextId = 0
const waiting = new Map<number, { resolve(text: string): void; reject(err: Error): void }>()
let loading: { model: string; promise: Promise<WhisperDevice> } | null = null
let progressListener: ((p: LoadProgress) => void) | null = null

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<any>) => {
    const m = e.data
    if (m.type === 'progress') progressListener?.(m)
    if (m.type === 'result') {
      const w = waiting.get(m.id)
      waiting.delete(m.id)
      if (!w) return
      if (m.error) w.reject(new Error(m.error))
      else w.resolve(m.text ?? '')
    }
  }
  return worker
}

// The ONNX Runtime files ship with the app (copied by scripts/copy-ort.mjs) and are
// served from the renderer root, one level above this page (main/index.html).
const ortPath = new URL('../ort/', document.baseURI).href

export type WhisperDevice = 'webgpu' | 'wasm'
let readyDevice: WhisperDevice = 'wasm'

// Resolves with where the model runs: 'webgpu' (GPU) or 'wasm' (CPU).
export function loadWhisper(
  model: WhisperModel,
  opts: { allowRemote: boolean; onProgress?: (p: LoadProgress) => void }
): Promise<WhisperDevice> {
  if (readyModel === model) return Promise.resolve(readyDevice)
  if (loading?.model === model) return loading.promise
  const w = getWorker()
  progressListener = opts.onProgress ?? null
  const promise = new Promise<WhisperDevice>((resolve, reject) => {
    const onMsg = (e: MessageEvent<any>) => {
      if (e.data.type === 'ready' && e.data.model === model) {
        w.removeEventListener('message', onMsg)
        readyModel = model
        readyDevice = e.data.device === 'webgpu' ? 'webgpu' : 'wasm'
        loading = null
        resolve(readyDevice)
      } else if (e.data.type === 'load-error') {
        w.removeEventListener('message', onMsg)
        loading = null
        reject(
          new Error(
            opts.allowRemote
              ? `Could not load the Whisper model: ${e.data.message}`
              : 'The Whisper model is not downloaded yet, and the kill switch blocks downloads. Turn the kill switch off once to download it.'
          )
        )
      }
    }
    w.addEventListener('message', onMsg)
  })
  loading = { model, promise }
  w.postMessage({ type: 'load', model, allowRemote: opts.allowRemote, ortPath })
  return promise
}

// Transcribes one complete audio chunk. Silent chunks return '' without running the model.
export async function transcribeChunk(bytes: Uint8Array, language: string): Promise<string> {
  const samples = await decodeTo16kMono(bytes)
  if (rms(samples) < SILENCE_RMS) return ''
  const id = ++nextId
  const text = await new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().postMessage({ type: 'transcribe', id, audio: samples, language }, [samples.buffer])
  })
  return cleanTranscript(text)
}
