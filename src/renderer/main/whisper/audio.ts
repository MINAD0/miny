// Audio helpers for local Whisper, which expects 16 kHz mono samples.
export const WHISPER_RATE = 16000

// Decodes a complete audio file (each WebM chunk is one) to 16 kHz mono.
export async function decodeTo16kMono(bytes: Uint8Array): Promise<Float32Array> {
  const probe = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await probe.decodeAudioData(bytes.slice().buffer)
  } finally {
    void probe.close()
  }
  const length = Math.max(1, Math.ceil(decoded.duration * WHISPER_RATE))
  const offline = new OfflineAudioContext(1, length, WHISPER_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded // channels are mixed down to mono by the 1-channel context
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

// Root-mean-square loudness of the samples.
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

// Below this, a chunk is treated as silence and not sent to Whisper,
// which otherwise tends to invent text on silent audio.
export const SILENCE_RMS = 0.003

// Whisper invents these for silence, music, or cut-off audio (it learned them from
// video subtitles). A chunk that is only one of these is dropped.
const STOCK_PHRASES = [
  /^thank(s| you) (so much )?for watching[.!]*$/i,
  /^thank you[.!]*$/i,
  /^please subscribe[.!]*$/i,
  /^you[.!]*$/i,
  /^sous-titr(es|age) .*amara\.org.*$/i,
  /^sous-titres réalisés .*$/i,
  /^merci d'avoir regardé[.!]*$/i,
  /^merci[.!]*$/i
]

// Markers Whisper emits for non-speech audio, e.g. [BLANK_AUDIO], (music), ♪.
const NOISE_ONLY = /^\s*(\[[^\]]*\]|\([^)]*\)|♪+|\.+)\s*$/

// The same word 5+ times in a row is a decoding loop, not speech.
const REPETITION_LOOP = /\b(\p{L}+)(?:[\s,.!?]+\1\b){4,}/iu

export function cleanTranscript(text: string): string {
  const t = text.replace(/\[BLANK_AUDIO\]/gi, '').trim()
  if (!t || NOISE_ONLY.test(t)) return ''
  if (STOCK_PHRASES.some((p) => p.test(t))) return ''
  if (REPETITION_LOOP.test(t)) return ''
  return t
}
