import type { ChatMessage } from '../providers/types'
import { getCaps } from '../providers/capabilities'

export function checkVision(providerId: string, model: string): { ok: true } | { ok: false; reason: string } {
  if (getCaps(providerId, model).vision) return { ok: true }
  return { ok: false, reason: `The model "${model}" does not support images. Pick a vision-capable model to use Vision.` }
}

export function buildVisionMessage(question: string, base64Png: string): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'image', mime: 'image/png', base64: base64Png },
      { type: 'text', text: question }
    ]
  }
}
