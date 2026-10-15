import type { ChatRequest } from '../providers/types'
import type { Segment } from './listen'

type Chat = { stream(req: Omit<ChatRequest, 'model'>): AsyncIterable<string> }

const SYSTEM =
  'You help the user answer questions in a live conversation. Give a concise, direct answer they can say out loud. Keep it under 120 words unless asked otherwise.'

export function createSuggester(deps: { chat: Chat; contextSegments?: number }) {
  const n = deps.contextSegments ?? 20

  function contextBlock(recent: Segment[] | null): string {
    if (!recent || recent.length === 0) return ''
    const last = recent.slice(-n)
    return 'Recent conversation:\n' + last.map((s) => `- ${s.text}`).join('\n') + '\n\n'
  }

  async function run(userText: string, onToken: (t: string) => void): Promise<string> {
    let full = ''
    for await (const t of deps.chat.stream({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userText }
      ]
    })) {
      full += t
      onToken(t)
    }
    return full
  }

  return {
    suggest(question: string, recent: Segment[], onToken: (t: string) => void) {
      return run(`${contextBlock(recent)}Question: ${question}`, onToken)
    },
    ask(question: string, recent: Segment[] | null, onToken: (t: string) => void) {
      return run(`${contextBlock(recent)}${question}`, onToken)
    }
  }
}
