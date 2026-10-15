export type SseEvent = { event?: string; data: string }

// Parses a Server-Sent Events body per the spec: CR, LF, or CRLF line endings,
// optional space after "data:", multi-line data, and a final event without a
// trailing blank line. Cancels the reader if the consumer stops early.
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let event: string | undefined
  let data: string[] = []

  function* takeLines(final: boolean): Generator<SseEvent> {
    while (true) {
      const m = /\r\n|\r|\n/.exec(buf)
      // A lone trailing CR may be the first half of CRLF, so wait for more input.
      if (!m || (m[0] === '\r' && m.index === buf.length - 1 && !final)) break
      const line = buf.slice(0, m.index)
      buf = buf.slice(m.index + m[0].length)
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') }
        event = undefined
        data = []
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') data.push(value)
      else if (field === 'event') event = value
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      yield* takeLines(false)
    }
    buf += dec.decode()
    yield* takeLines(true)
    if (buf.length) {
      buf += '\n'
      yield* takeLines(true)
    }
    if (data.length) yield { event, data: data.join('\n') }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}
