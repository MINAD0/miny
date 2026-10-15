import { ProviderError } from '../providers/types'
import type { Transcriber } from './types'

// Checks the kill switch on every chunk, so turning it on mid-session stops audio from leaving the machine.
export function guardTranscriber(inner: Transcriber, isBlocked: () => boolean): Transcriber {
  return {
    transcribe(audio, opts) {
      if (isBlocked()) return Promise.reject(new ProviderError('other', 'Network is disabled by the kill switch'))
      return inner.transcribe(audio, opts)
    }
  }
}
