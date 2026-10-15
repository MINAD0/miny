import { app, BrowserWindow, globalShortcut, ipcMain, IpcMainInvokeEvent, safeStorage, WebContents } from 'electron'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { openDb } from './storage/db'
import { createNotesRepo } from './storage/notes'
import { createSecretStore } from './secrets'
import { noteToMarkdown, safeFilename } from './export/markdown'
import { uniquePath } from './export/uniquePath'
import { createTracker } from './tracking/events'
import { createRegistry, ProviderConfig } from './providers/registry'
import { toProviderConfig } from './providers/validate'
import { createOpenAICompatProvider } from './providers/openaiCompat'
import { createAnthropicProvider } from './providers/anthropic'
import { createOpenAITranscriber } from './transcription/openaiTranscribe'
import { guardTranscriber } from './transcription/guard'
import type { Transcriber } from './transcription/types'
import { createListenLoop, Segment } from './session/listen'
import { createSuggester } from './session/suggest'
import { isQuestion } from './session/questionDetector'
import { createOverlay } from './overlay'
import { installLoopbackHandler } from './capture/loopbackHandler'
import { captureScreenPng } from './capture/screenshot'
import { buildVisionMessage, checkVision } from './capture/vision'
import { findProvider } from '../shared/providers'
import { fetchOpenRouterModels, ModelInfo } from './providers/modelList'
import { learnCaps } from './providers/capabilities'

// Tests point the app at a throwaway profile so they never touch real notes.
if (process.env.MINY_USER_DATA) {
  app.setPath('userData', process.env.MINY_USER_DATA)
  app.setPath('documents', join(process.env.MINY_USER_DATA, 'documents'))
}
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

const DEFAULT_PROVIDER: ProviderConfig = toProviderConfig({ providerId: 'openai', model: 'gpt-4o-mini' })

// Saved settings are re-validated on load, so an edited database can't redirect keys either.
function currentProvider(): ProviderConfig {
  try {
    return toProviderConfig(readSetting('llm.provider', DEFAULT_PROVIDER))
  } catch {
    return DEFAULT_PROVIDER
  }
}

const registry = createRegistry({
  secrets,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  build: (cfg, apiKey) => {
    if (cfg.providerId === 'anthropic') return createAnthropicProvider({ apiKey: apiKey!, baseUrl: cfg.baseUrl })
    return createOpenAICompatProvider({ id: cfg.providerId, baseUrl: cfg.baseUrl, apiKey })
  }
})
registry.configure(currentProvider())
registry.setKillSwitch(readSetting('killswitch', false))

const suggester = createSuggester({ chat: { stream: (req) => registry.stream(req) } })

let overlay: ReturnType<typeof createOverlay> | null = null
let mainWin: BrowserWindow | null = null
let transcriber: Transcriber | null = null

// Rolling transcript of the current session, kept in time order. Used as context for suggestions and Ask.
const transcript: Segment[] = []
let sessionStartedAt = Date.now()

let overlaySeq = 0
const nextOverlayId = () => `${Date.now()}-${++overlaySeq}`

function sendOverlay(item: { id: string; question: string; answer: string; error?: string; partial?: boolean }) {
  if (overlay && !overlay.window.isDestroyed()) overlay.send('overlay:update', item)
}

function sendMain(channel: string, payload: unknown) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload)
}

// Requests that the kill switch will block are not logged as if they were sent.
function recordRequest(name: string, props: Record<string, unknown>) {
  if (!registry.isKilled()) tracker.record(name, props)
}

async function answer(question: string, context: Segment[] | null, kind: 'suggest' | 'ask') {
  const id = nextOverlayId()
  recordRequest('suggestion_requested', { provider: currentProvider().providerId, kind })
  sendOverlay({ id, question, answer: '' })
  let soFar = ''
  const onToken = (t: string) => {
    soFar += t
    sendOverlay({ id, question, answer: soFar, partial: true })
  }
  try {
    const full =
      kind === 'suggest' ? await suggester.suggest(question, context ?? [], onToken) : await suggester.ask(question, context, onToken)
    sendOverlay({ id, question, answer: full || '(no answer returned)' })
  } catch (e) {
    sendOverlay({ id, question, answer: soFar, error: (e as Error).message })
  }
}

// Auto-suggestions run one at a time. If questions arrive while one is answering,
// only the most recent waits; older ones are dropped as stale.
let autoBusy = false
let autoNext: string | null = null
async function autoSuggest(question: string) {
  if (autoBusy) {
    autoNext = question
    return
  }
  autoBusy = true
  try {
    let q: string | null = question
    while (q) {
      await answer(q, transcript, 'suggest')
      q = autoNext
      autoNext = null
    }
  } finally {
    autoBusy = false
  }
}

function insertInOrder(list: Segment[], seg: Segment) {
  let i = list.length
  while (i > 0 && list[i - 1].t_start > seg.t_start) i--
  list.splice(i, 0, seg)
}

const listen = createListenLoop({
  get transcriber() {
    return transcriber!
  },
  onSegment: (seg) => {
    insertInOrder(transcript, seg)
    sendMain('listen:segment', seg)
    if (isQuestion(seg.text)) void autoSuggest(seg.text)
  },
  onError: (err) => {
    sendOverlay({ id: nextOverlayId(), question: 'Transcription', answer: '', error: (err as Error).message })
  },
  saveSession: (segs) => {
    const cfg = currentProvider()
    const started = sessionStartedAt
    // One transaction, so a failure can't leave a session without its note.
    return db.transaction(() => {
      const sid = Number(
        db
          .prepare("INSERT INTO sessions (started_at, ended_at, mode, provider, model) VALUES (?, ?, 'meeting', ?, ?)")
          .run(started, Date.now(), cfg.providerId, cfg.model).lastInsertRowid
      )
      const ins = db.prepare('INSERT INTO segments (session_id, t_start, t_end, text) VALUES (?, ?, ?, ?)')
      for (const s of segs) ins.run(sid, s.t_start, s.t_end, s.text)
      notes.create({
        title: `Session ${new Date(started).toLocaleString()}`,
        body_md: segs.map((s) => s.text).join('\n'),
        session_id: sid
      })
      tracker.record('session_saved', { segments: segs.length })
      return sid
    })()
  }
})

// Loads OpenRouter's live model list and records which models accept images, so Vision
// knows about them. Outbound, so the kill switch blocks it.
async function loadOpenRouterModels(): Promise<ModelInfo[]> {
  if (registry.isKilled()) throw new Error('Network is disabled by the kill switch')
  const models = await fetchOpenRouterModels()
  for (const m of models) learnCaps('openrouter', m.id, { vision: m.vision, contextTokens: m.contextTokens })
  return models
}

// Only the main window may call IPC handlers. The overlay has its own receive-only preload.
function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWin || event.sender !== mainWin.webContents) throw new Error('Not allowed')
    return fn(event, ...args)
  })
}

function registerIpc() {
  // Notes
  handle('notes:create', (_, input) => notes.create(input))
  handle('notes:update', (_, id, patch) => notes.update(id, patch))
  handle('notes:get', (_, id) => notes.get(id))
  handle('notes:list', (_, filter) => notes.list(filter))
  handle('notes:search', (_, q) => notes.search(q))
  handle('notes:tags', (_, id) => notes.tagsFor(id))
  handle('notes:setTags', (_, id, tags) => notes.setTags(id, tags))
  handle('notes:export', (_, id) => {
    const n = notes.get(id)
    if (!n) throw new Error('note not found')
    const dir = join(app.getPath('documents'), 'miny')
    mkdirSync(dir, { recursive: true })
    const path = uniquePath(dir, safeFilename(n.title, n.id))
    writeFileSync(path, noteToMarkdown(n, notes.tagsFor(id)), 'utf8')
    return path
  })

  // Folders
  handle('folders:list', () => notes.listFolders())
  handle('folders:create', (_, name: string) => {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) throw new Error('Folder name cannot be empty')
    return notes.createFolder(trimmed)
  })

  // Settings and keys
  handle('settings:get', (_, key) => readSetting(key, null))
  handle('settings:set', (_, key: string, value) => {
    if (key === 'llm.provider') {
      const cfg = toProviderConfig(value)
      writeSetting(key, cfg)
      registry.configure(cfg)
      return true
    }
    // Security-relevant settings have their own handlers and can't be set here.
    if (key === 'killswitch' || key === 'tracking.consent') throw new Error('Use the dedicated control for this setting')
    writeSetting(key, value)
    return true
  })
  handle('keys:set', (_, providerId: string, key: string) => {
    if (!findProvider(providerId)) throw new Error('Unknown provider')
    secrets.set(providerId, String(key))
    return true
  })
  handle('models:list', async (_, providerId: string) => (providerId === 'openrouter' ? loadOpenRouterModels() : []))
  handle('keys:has', (_, providerId: string) => {
    try {
      return secrets.get(providerId) !== null
    } catch {
      return false
    }
  })

  // Listen
  handle('listen:start', () => {
    if (listen.isActive()) throw new Error('Already listening')
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
  handle('listen:stop', () => listen.stop('user'))
  handle('listen:chunk', (_, bytes: Uint8Array, mime: string, s: number, e: number) =>
    listen.pushChunk(new Uint8Array(bytes), mime, s, e)
  )

  // Ask and Vision
  handle('ask:send', (_, question: string, useContext: boolean) => answer(question, useContext ? transcript : null, 'ask'))
  handle('ask:vision', async (_, question: string) => {
    const cfg = currentProvider()
    const caps = checkVision(cfg.providerId, cfg.model)
    if (!caps.ok) throw new Error(caps.reason)
    const id = nextOverlayId()
    const label = `[screen] ${question}`
    recordRequest('vision_requested', { provider: cfg.providerId })
    sendOverlay({ id, question: label, answer: '' })
    let full = ''
    try {
      const png = await captureScreenPng()
      for await (const t of registry.stream({
        messages: [{ role: 'system', content: 'Answer the question about the screenshot concisely.' }, buildVisionMessage(question, png)]
      })) {
        full += t
        sendOverlay({ id, question: label, answer: full, partial: true })
      }
      sendOverlay({ id, question: label, answer: full || '(no answer returned)' })
    } catch (e) {
      sendOverlay({ id, question: label, answer: full, error: (e as Error).message })
    }
  })

  // Tracking
  handle('tracking:consent', (_, granted: boolean) => {
    if (granted === true) tracker.setConsent(true)
    else tracker.revokeAndWipe() // revoking always deletes history
  })
  handle('tracking:log', () => tracker.activityLog())
  handle('tracking:wipe', () => tracker.revokeAndWipe())

  // Kill switch
  handle('killswitch:set', (_, on: boolean) => {
    const value = on === true
    registry.setKillSwitch(value)
    writeSetting('killswitch', value)
    return value
  })
}

// Neither window may navigate away or open new windows.
function lockDown(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (e) => e.preventDefault())
}

app.whenReady().then(() => {
  installLoopbackHandler()
  registerIpc()

  // Learn OpenRouter model capabilities in the background so Vision works without opening Settings.
  if (currentProvider().providerId === 'openrouter') void loadOpenRouterModels().catch(() => undefined)

  mainWin = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true }
  })
  lockDown(mainWin.webContents)
  mainWin.loadFile(join(__dirname, '../renderer/main/index.html'))

  overlay = createOverlay({
    hotkey: readSetting('hotkey.overlay', 'Control+Shift+Space'),
    preloadPath: join(__dirname, '../preload/overlay.js'),
    htmlPath: join(__dirname, '../renderer/overlay/index.html')
  })
  lockDown(overlay.window.webContents)

  // Closing the main window quits the app; the overlay alone has no taskbar entry or close button.
  mainWin.on('closed', () => {
    mainWin = null
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())

// Save a running session before quitting. listen.stop waits for in-flight chunks
// (each bounded by the transcription timeout).
let savingBeforeQuit = false
app.on('before-quit', (e) => {
  if (!listen.isActive() || savingBeforeQuit) return
  e.preventDefault()
  savingBeforeQuit = true
  void listen.stop('user').finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  db.close()
})
