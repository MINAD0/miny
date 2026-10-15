import { describe, expect, it } from 'vitest'
import { sseEvents } from '../../../src/main/providers/sse'

function body(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    }
  })
}

async function collect(b: ReadableStream<Uint8Array>) {
  const out = []
  for await (const e of sseEvents(b)) out.push(e)
  return out
}

describe('sseEvents', () => {
  it('parses LF-framed events', async () => {
    expect(await collect(body('data: a\n\ndata: b\n\n'))).toEqual([{ data: 'a' }, { data: 'b' }])
  })

  it('parses CRLF-framed events', async () => {
    expect(await collect(body('data: a\r\n\r\ndata: b\r\n\r\n'))).toEqual([{ data: 'a' }, { data: 'b' }])
  })

  it('handles CRLF split across reads', async () => {
    expect(await collect(body('data: a\r', '\n\r', '\n'))).toEqual([{ data: 'a' }])
  })

  it('emits a final event with no trailing blank line', async () => {
    expect(await collect(body('data: a\n\ndata: b'))).toEqual([{ data: 'a' }, { data: 'b' }])
  })

  it('accepts data: with no space and keeps event names', async () => {
    expect(await collect(body('event: error\ndata:{"x":1}\n\n'))).toEqual([{ event: 'error', data: '{"x":1}' }])
  })

  it('joins multi-line data and skips comments', async () => {
    expect(await collect(body(': keepalive\ndata: one\ndata: two\n\n'))).toEqual([{ data: 'one\ntwo' }])
  })

  it('handles an event split across reads', async () => {
    expect(await collect(body('da', 'ta: hel', 'lo\n', '\n'))).toEqual([{ data: 'hello' }])
  })
})
