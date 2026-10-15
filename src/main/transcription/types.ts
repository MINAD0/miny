export interface Transcriber {
  transcribe(audio: { bytes: Uint8Array; mime: string }, opts?: { language?: string }): Promise<{ text: string }>
}
