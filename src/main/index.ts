import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { openDb } from './storage/db'
import { createNotesRepo } from './storage/notes'
import { createSecretStore } from './secrets'
import { noteToMarkdown, safeFilename } from './export/markdown'
import { createTracker } from './tracking/events'
import { createRegistry, ProviderConfig } from './providers/registry'
import { createOpenAICompatProvider } from './providers/openaiCompat'
import { createAnthropicProvider } from './providers/anthropic'
import { createOpenAITranscriber } from './transcription/openaiTranscribe'
import { guardTranscriber } from './transcription/guard'
import type { Transcriber } from './transcription/types'
import { createListenLoop, Segment } from './session/listen'
import { createSuggester } from './session/suggest'
import { detectQuestions } from './session/questionDetector'
import { createOverlay } from './overlay'
import { installLoopbackHandler } from './capture/loopbackHandler'
import { captureScreenPng } from './capture/screenshot'
import { buildVisionMessage, checkVision } from './capture/vision'

// Tests point the app at a throwaway profile so they never touch real notes.
if (process.env.MINY_USER_DATA) app.setPath('userData', process.env.MINY_USER_DATA)
const dataDir = app.getPath('userData')
mkdirSync(dataDir, { recursive: true })
const db = openDb(join(dataDir, 'miny.db'))
const notes = createNotesRepo(db)
const tracker = createTracker(db)
const secrets = createSecretStore({ safeStorage, file: join(dataDir, 'secrets.json') })

function readSetting<T>(key: string, fallback: T): T {
  const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
  return r ? (JSON.parse(r.value_json) as T) : fallback
}
function writeSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(
    key,
    JSON.stringify(value)
  )
}

const DEFAULT_PROVIDER: ProviderConfig = {
  providerId: 'openai',
  model: 'gpt-4o-mini',
  needsKey: true,
  baseUrl: 'https://api.openai.com/v1'
}

const registry = createRegistry({
  secrets,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  build: (cfg, apiKey) => {
    if (cfg.providerId === 'anthropic') return createAnthropicProvider({ apiKey: apiKey!, baseUrl: cfg.baseUrl })
    return createOpenAICompatProvider({ id: cfg.providerId, baseUrl: cfg.baseUrl, apiKey })
  }
})
registry.configure(readSetting<ProviderConfig>('llm.provider', DEFAULT_PROVIDER))
registry.setKillSwitch(readSetting('killswitch', false))

const suggester = createSuggester({ chat: { stream: (req) => registry.stream(req) } })

let overlay: ReturnType<typeof createOverlay> | null = null
let mainWin: BrowserWindow | null = null
let transcriber: Transcriber | null = null

// Rolling transcript of the current session. Used as context for suggestions and Ask.
const transcript: Segment[] = []
let sessionStartedAt = Date.now()

function sendOverlay(item: { id: string; question: string; answer: string; error?: string; partial?: boolean }) {
  overlay?.send('overlay:update', item)
}

async function answer(question: string, context: Segment[] | null, kind: 'suggest' | 'ask') {
  const id = String(Date.now())
  const cfg = readSetting<ProviderConfig>('llm.provider', DEFAULT_PROVIDER)
  tracker.record('suggestion_requested', { provider: cfg.providerId, kind })
  sendOverlay({ id, question, answer: '' })
  let soFar = ''
  const onToken = (t: string) => {
    soFar += t
    sendOverlay({ id, question, answer: soFar, partial: true })
  }
  try {
    const full =
      kind === 'suggest' ? await suggester.suggest(question, context ?? [], onToken) : await suggester.ask(question, context, onToken)
    sendOverlay({ id, question, answer: full })
  } catch (e) {
    sendOverlay({ id, question, answer: '', error: (e as Error).message })
  }
}

const listen = createListenLoop({
  get transcriber() {
    return transcriber!
  },
  onSegment: (seg) => {
    transcript.push(seg)
    mainWin?.webContents.send('listen:segment', seg)
    if (detectQuestions([seg]).length) void answer(seg.text, transcript, 'suggest')
  },
  onError: (err) => {
    sendOverlay({ id: String(Date.now()), question: 'Transcription', answer: '', error: (err as Error).message })
  },
  saveSession: (segs) => {
    const started = sessionStartedAt
    const sid = Number(
      db
        .prepare("INSERT INTO sessions (started_at, ended_at, mode) VALUES (?, ?, 'meeting')")
        .run(started, Date.now()).lastInsertRowid
    )
    const ins = db.prepare('INSERT INTO segments (session_id, t_start, t_end, text) VALUES (?, ?, ?, ?)')
    for (const s of segs) ins.run(sid, s.t_start, s.t_end, s.text)
    const body = segs.map((s) => s.text).join('\n')
    notes.create({ title: `Session ${new Date(started).toLocaleString()}`, body_md: body, session_id: sid })
    tracker.record('session_saved', { segments: segs.length })
    return sid
  }
})

function registerIpc() {
  // Notes
  ipcMain.handle('notes:create', (_, input) => notes.create(input))
  ipcMain.handle('notes:update', (_, id, patch) => notes.update(id, patch))
  ipcMain.handle('notes:get', (_, id) => notes.get(id))
  ipcMain.handle('notes:list', (_, filter) => notes.list(filter))
  ipcMain.handle('notes:search', (_, q) => notes.search(q))
  ipcMain.handle('notes:tags', (_, id) => notes.tagsFor(id))
  ipcMain.handle('notes:setTags', (_, id, tags) => notes.setTags(id, tags))
  ipcMain.handle('notes:export', (_, id) => {
    const n = notes.get(id)
    if (!n) throw new Error('note not found')
    const dir = join(app.getPath('documents'), 'miny')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, safeFilename(n.title, n.id))
    writeFileSync(path, noteToMarkdown(n, notes.tagsFor(id)), 'utf8')
    return path
  })

  // Folders
  ipcMain.handle('folders:list', () => notes.listFolders())
  ipcMain.handle('folders:create', (_, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Folder name cannot be empty')
    return notes.createFolder(trimmed)
  })

  // Settings and keys
  ipcMain.handle('settings:get', (_, key) => readSetting(key, null))
  ipcMain.handle('settings:set', (_, key, value) => {
    writeSetting(key, value)
    if (key === 'llm.provider') registry.configure(value as ProviderConfig)
    return true
  })
  ipcMain.handle('keys:set', (_, providerId: string, key: string) => {
    secrets.set(providerId, key)
    return true
  })
  ipcMain.handle('keys:has', (_, providerId: string) => secrets.get(providerId) !== null)

  // Listen
  ipcMain.handle('listen:start', () => {
    const key = secrets.get('openai')
    if (!key) throw new Error('Set your OpenAI key in Settings to use transcription')
    transcript.length = 0
    sessionStartedAt = Date.now()
    transcriber = guardTranscriber(
      createOpenAITranscriber({ apiKey: key, model: readSetting('stt.model', 'gpt-4o-transcribe') }),
      () => registry.isKilled()
    )
    listen.start()
    tracker.record('session_started', { mode: 'meeting' })
    return true
  })
  ipcMain.handle('listen:stop', () => listen.stop('user'))
  ipcMain.handle('listen:chunk', (_, bytes: Uint8Array, mime: string, s: number, e: number) =>
    listen.pushChunk(new Uint8Array(bytes), mime, s, e)
  )

  // Ask and Vision
  ipcMain.handle('ask:send', (_, question: string, useContext: boolean) =>
    answer(question, useContext ? transcript : null, 'ask')
  )
  ipcMain.handle('ask:vision', async (_, question: string) => {
    const cfg = readSetting<ProviderConfig>('llm.provider', DEFAULT_PROVIDER)
    const caps = checkVision(cfg.providerId, cfg.model)
    if (!caps.ok) throw new Error(caps.reason)
    const png = await captureScreenPng()
    const id = String(Date.now())
    sendOverlay({ id, question: `[screen] ${question}`, answer: '' })
    tracker.record('vision_requested', { provider: cfg.providerId })
    try {
      let full = ''
      for await (const t of registry.stream({
        messages: [{ role: 'system', content: 'Answer the question about the screenshot concisely.' }, buildVisionMessage(question, png)]
      })) {
        full += t
        sendOverlay({ id, question: `[screen] ${question}`, answer: full, partial: true })
      }
      sendOverlay({ id, question: `[screen] ${question}`, answer: full })
    } catch (e) {
      sendOverlay({ id, question: `[screen] ${question}`, answer: '', error: (e as Error).message })
    }
  })

  // Tracking
  ipcMain.handle('tracking:consent', (_, granted: boolean) => tracker.setConsent(granted))
  ipcMain.handle('tracking:log', () => tracker.activityLog())
  ipcMain.handle('tracking:wipe', () => tracker.revokeAndWipe())

  // Kill switch
  ipcMain.handle('killswitch:set', (_, on: boolean) => {
    registry.setKillSwitch(on)
    writeSetting('killswitch', on)
    return on
  })
}

app.whenReady().then(() => {
  installLoopbackHandler()
  registerIpc()

  const preloadPath = join(__dirname, '../preload/index.js')
  mainWin = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true }
  })
  mainWin.loadFile(join(__dirname, '../renderer/main/index.html'))

  overlay = createOverlay({
    hotkey: readSetting('hotkey.overlay', 'Control+Shift+Space'),
    preloadPath,
    htmlPath: join(__dirname, '../renderer/overlay/index.html')
  })
})

app.on('will-quit', () => {
  db.close()
})
