// Runs Whisper locally (ONNX) so audio never leaves the machine.
// Uses the GPU (WebGPU) when available, otherwise the CPU (WASM).
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

type LoadMsg = { type: 'load'; model: string; allowRemote: boolean; ortPath: string }
type TranscribeMsg = { type: 'transcribe'; id: number; audio: Float32Array; language: string }
type InMsg = LoadMsg | TranscribeMsg

// A 5-second chunk is ~15 words. Capping output stops runaway repetition loops,
// which otherwise also take many seconds to generate.
const MAX_NEW_TOKENS = 64

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loadedModel = ''

// Messages are handled one at a time, in order.
let queue: Promise<void> = Promise.resolve()
self.onmessage = (e: MessageEvent<InMsg>) => {
  queue = queue.then(() => handle(e.data)).catch(() => undefined)
}

async function gpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function build(model: string, device: 'webgpu' | 'wasm') {
  return (await pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}`, {
    device,
    // On the GPU the encoder runs in full precision; quantized weights keep the CPU path small.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: any) => {
      if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
    }
  })) as AutomaticSpeechRecognitionPipeline
}

async function handle(msg: InMsg) {
  if (msg.type === 'load') {
    try {
      if (asr && loadedModel === msg.model) {
        self.postMessage({ type: 'ready', model: msg.model })
        return
      }
      env.allowLocalModels = false
      // With the kill switch on, only an already-downloaded model may load.
      env.allowRemoteModels = msg.allowRemote
      // Use the runtime shipped with the app, never the CDN default.
      env.backends.onnx.wasm!.wasmPaths = {
        mjs: `${msg.ortPath}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${msg.ortPath}ort-wasm-simd-threaded.asyncify.wasm`
      }
      asr = null
      let device: 'webgpu' | 'wasm' = (await gpuAvailable()) ? 'webgpu' : 'wasm'
      try {
        asr = await build(msg.model, device)
      } catch (gpuErr) {
        if (device !== 'webgpu') throw gpuErr
        device = 'wasm' // GPU present but unusable: fall back to the CPU
        asr = await build(msg.model, device)
      }
      loadedModel = msg.model
      self.postMessage({ type: 'ready', model: msg.model, device })
    } catch (err) {
      self.postMessage({ type: 'load-error', message: String((err as Error)?.message ?? err) })
    }
    return
  }

  if (msg.type === 'transcribe') {
    if (!asr) {
      self.postMessage({ type: 'result', id: msg.id, error: 'The Whisper model is not loaded' })
      return
    }
    try {
      // The language must be explicit: without it, Whisper here outputs English
      // (French speech came back translated in testing).
      const out = (await asr(msg.audio, {
        language: msg.language,
        task: 'transcribe',
        max_new_tokens: MAX_NEW_TOKENS
      } as any)) as { text: string }
      self.postMessage({ type: 'result', id: msg.id, text: out.text })
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, error: String((err as Error)?.message ?? err) })
    }
  }
}
