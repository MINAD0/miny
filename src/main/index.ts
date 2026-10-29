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
import { isFollowUp, isQuestion } from './session/questionDetector'
import { generateSummary, transcriptText } from './session/summary'
import { createOverlay } from './overlay'
import { installLoopbackHandler } from './capture/loopbackHandler'
import { captureScreenPng } from './capture/screenshot'
import { buildVisionMessage, checkVision } from './capture/vision'
import { findProvider } from '../shared/providers'
import { fetchOpenRouterModels, ModelInfo } from './providers/modelList'
import { describeKeyInfo, fetchOpenRouterKeyInfo } from './providers/openrouterKey'
import { getCaps, learnCaps } from './providers/capabilities'
import { pickFallbacks } from '../shared/fallbacks'
import { toSttConfig } from '../shared/transcription'
import { toAnswerStyle } from '../shared/answerStyle'
import { createContextStore } from './context/store'
import type { QaPair } from '../shared/qa'

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
const contextStore = createContextStore(db)
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

// Answer length, vocabulary, and optional translation. Re-validated on read.
function currentAnswerStyle() {
  return toAnswerStyle(readSetting('answer.style', null))
}

const registry = createRegistry({
  secrets,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  build: (cfg, apiKey) => {
    if (cfg.providerId === 'anthropic') return createAnthropicProvider({ apiKey: apiKey!, baseUrl: cfg.baseUrl })
    return createOpenAICompatProvider({ id: cfg.providerId, baseUrl: cfg.baseUrl, apiKey })
  },
  supportsVision: (providerId, model) => getCaps(providerId, model).vision
})

// Last OpenRouter model list, used to pick backup models for a busy free model.
let openRouterModels: ModelInfo[] = []

// Applies the saved provider, plus automatic backups when it's a free OpenRouter model.
function applyProvider(): ProviderConfig {
  const cfg = currentProvider()
  const fallbackModels = cfg.providerId === 'openrouter' ? pickFallbacks(openRouterModels, cfg.model) : []
  const full = { ...cfg, fallbackModels }
  registry.configure(full)
  return full
}
applyProvider()
registry.setKillSwitch(readSetting('killswitch', false))

const suggester = createSuggester({
  chat: { stream: (req) => registry.stream(req) },
  context: () => contextStore.promptContext(),
  style: () => currentAnswerStyle()
})

let overlay: ReturnType<typeof createOverlay> | null = null
let mainWin: BrowserWindow | null = null
let transcriber: Transcriber | null = null

// Rolling transcript of the current session, kept in time order. Used as context for suggestions and Ask.
const transcript: Segment[] = []
let sessionStartedAt = Date.now()

// Questions/answers for the running session, saved with its note.
let sessionQa: QaPair[] = []
let lastQuestion = ''
let lastQuestionAt = 0
// Answers still streaming. Stop waits briefly so their text reaches the note.
const inFlightAnswers = new Set<Promise<unknown>>()
// Summaries running after a session was saved. Quit waits for them.
const pendingSummaries = new Set<Promise<void>>()
let shuttingDown = false

async function waitForAnswers(ms: number): Promise<void> {
  if (!inFlightAnswers.size) return
  await Promise.race([
    Promise.allSettled([...inFlightAnswers]),
    new Promise<void>((resolve) => setTimeout(resolve, ms))
  ])
}

// The note is saved with the raw transcript immediately. If a provider is
// available, a structured summary replaces the body shortly after (smog does the
// same through its note_summary module). Failure leaves the transcript intact.
function scheduleSummary(noteId: number, segments: Segment[], qa: QaPair[]): void {
  if (!registry.available()) return
  const job = (async () => {
    // Let answers that were still streaming when Stop was pressed reach the note.
    await waitForAnswers(8000)
    const summary = await generateSummary({ call: (req) => registry.call(req) }, segments, qa)
    // The app may be quitting (database already closed) by the time a slow
    // provider replies. The raw transcript is already saved, so drop the update.
    if (!summary || shuttingDown || !notes.get(noteId)) return
    notes.update(noteId, { title: summary.title, body_md: summary.content })
    sendMain('notes:changed', { id: noteId })
  })().catch(() => undefined)
  pendingSummaries.add(job)
  void job.finally(() => pendingSummaries.delete(job))
}

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

function answer(question: string, context: Segment[] | null, kind: 'suggest' | 'ask'): Promise<void> {
  const id = nextOverlayId()
  recordRequest('suggestion_requested', { provider: currentProvider().providerId, kind })
  sendOverlay({ id, question, answer: '' })

  const run = (async () => {
    let soFar = ''
    const onToken = (t: string) => {
      soFar += t
      sendOverlay({ id, question, answer: soFar, partial: true })
    }
    try {
      const full =
        kind === 'suggest' ? await suggester.suggest(question, context ?? [], onToken) : await suggester.ask(question, context, onToken)
      // Keep the answer with the session. It goes into the note and gives the
      // summary prompt a record of what was already covered.
      const text = (full || '').trim()
      if (text) {
        sessionQa.push({ question, answer: text })
        if (sessionQa.length > 100) sessionQa.shift()
      }
      sendOverlay({ id, question, answer: full || '(no answer returned)' })
    } catch (e) {
      sendOverlay({ id, question, answer: soFar, error: (e as Error).message })
    }
  })()

  inFlightAnswers.add(run)
  void run.finally(() => inFlightAnswers.delete(run))
  return run
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
    if (isQuestion(seg.text)) {
      lastQuestion = seg.text
      lastQuestionAt = Date.now()
      void autoSuggest(seg.text)
    } else if (lastQuestion && Date.now() - lastQuestionAt < 60_000 && isFollowUp(seg.text)) {
      // "and why?" / "how so?" only mean something with the question before it.
      lastQuestionAt = Date.now()
      void autoSuggest(`${lastQuestion}\nFollow-up: ${seg.text}`)
    }
  },
  onError: (err) => {
    sendOverlay({ id: nextOverlayId(), question: 'Transcription', answer: '', error: (err as Error).message })
  },
  saveSession: (segs) => {
    const cfg = currentProvider()
    const started = sessionStartedAt
    const qa = sessionQa.slice()
    const raw = transcriptText(segs)
    // One transaction, so a failure can't leave a session without its note.
    let noteId = 0
    const sid = db.transaction(() => {
      const id = Number(
        db
          .prepare("INSERT INTO sessions (started_at, ended_at, mode, provider, model) VALUES (?, ?, 'meeting', ?, ?)")
          .run(started, Date.now(), cfg.providerId, cfg.model).lastInsertRowid
      )
      const ins = db.prepare('INSERT INTO segments (session_id, t_start, t_end, text) VALUES (?, ?, ?, ?)')
      for (const s of segs) ins.run(id, s.t_start, s.t_end, s.text)
      const note = notes.create({
        title: `Session ${new Date(started).toLocaleString()}`,
        // The transcript is the note until a summary replaces it. If no provider
        // is available, this is what the user keeps.
        body_md: raw,
        transcript: raw,
        qa,
        session_id: id
      })
      noteId = note.id
      tracker.record('session_saved', { segments: segs.length, questions: qa.length })
      return id
    })()
    // Summary runs after the commit, so a slow model never holds the write lock.
    scheduleSummary(noteId, segs, qa)
    return sid
  }
})

// Loads OpenRouter's live model list and records which models accept images, so Vision
// knows about them. Outbound, so the kill switch blocks it.
async function loadOpenRouterModels(): Promise<ModelInfo[]> {
  if (registry.isKilled()) throw new Error('Network is disabled by the kill switch')
  const models = await fetchOpenRouterModels()
  for (const m of models) learnCaps('openrouter', m.id, { vision: m.vision, contextTokens: m.contextTokens })
  openRouterModels = models
  applyProvider() // backups can be chosen now that the list is known
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

  // Rebuild a session note's summary from its stored segments.
  handle('notes:summarize', async (_, id: number) => {
    const n = notes.get(Number(id))
    if (!n) throw new Error('note not found')
    if (!n.session_id) throw new Error('This note has no session to summarize')
    if (!registry.available()) throw new Error('Connect a provider first (or turn off the kill switch)')
    const segs = db
      .prepare('SELECT t_start, t_end, text FROM segments WHERE session_id = ? ORDER BY t_start')
      .all(n.session_id) as Segment[]
    if (!segs.length) throw new Error('This session has no transcript')
    const summary = await generateSummary({ call: (req) => registry.call(req) }, segs, n.qa)
    if (!summary) throw new Error('The provider did not return a usable summary')
    const updated = notes.update(n.id, { title: summary.title, body_md: summary.content })
    sendMain('notes:changed', { id: n.id })
    return updated
  })

  // Resume and context documents. These are the facts the model may use for
  // personal questions ("tell me about yourself"); they are never invented.
  handle('context:list', () => contextStore.list())
  handle('context:saveResume', (_, name, text) => contextStore.saveResume(name, text))
  handle('context:add', (_, name, text) => contextStore.addDocument(name, text))
  handle('context:remove', (_, id: number) => {
    contextStore.removeDocument(Number(id))
    return true
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
      applyProvider()
      return true
    }
    if (key === 'answer.style') {
      writeSetting(key, toAnswerStyle(value))
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

  // Sends a tiny request to the active provider and reports the exact result or error.
  // For OpenRouter it also reports the key's spending limit and free-model quota.
  handle('providers:test', async () => {
    const cfg = currentProvider()
    let keyInfo: string | null = null
    if (cfg.providerId === 'openrouter' && !registry.isKilled()) {
      const key = (secrets.get('openrouter') ?? '').trim()
      if (key) {
        try {
          keyInfo = describeKeyInfo(await fetchOpenRouterKeyInfo(key))
        } catch (e) {
          keyInfo = `could not read key details: ${(e as Error).message}`
        }
      }
    }
    try {
      const reply = await registry.call({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 16 })
      return {
        ok: true,
        provider: cfg.providerId,
        model: cfg.model,
        answeredBy: registry.lastModelUsed(),
        reply: reply.trim().slice(0, 100),
        keyInfo
      }
    } catch (e) {
      return { ok: false, provider: cfg.providerId, model: cfg.model, answeredBy: null, error: (e as Error).message, keyInfo }
    }
  })
  handle('keys:has', (_, providerId: string) => {
    try {
      return secrets.get(providerId) !== null
    } catch {
      return false
    }
  })

  // Transcription settings (local Whisper by default)
  handle('stt:get', () => toSttConfig(readSetting('stt', null), app.getLocale()))
  handle('stt:set', (_, value) => {
    const cfg = toSttConfig(value, app.getLocale())
    writeSetting('stt', cfg)
    return cfg
  })

  // Listen. Returns the transcription config so the window knows whether to
  // transcribe locally (send text) or send audio chunks for OpenAI.
  handle('listen:start', () => {
    if (listen.isActive()) throw new Error('Already listening')
    const stt = toSttConfig(readSetting('stt', null), app.getLocale())
    if (stt.provider === 'openai') {
      const key = secrets.get('openai')
      if (!key) throw new Error('OpenAI transcription needs an OpenAI key. Add it in Settings, or switch to local Whisper.')
      transcriber = guardTranscriber(
        createOpenAITranscriber({ apiKey: key, model: readSetting('stt.model', 'gpt-4o-transcribe') }),
        () => registry.isKilled()
      )
    } else {
      // Local Whisper runs in the window and sends text; no audio reaches this process.
      transcriber = {
        transcribe: () => Promise.reject(new Error('Local Whisper sends text, not audio'))
      }
    }
    transcript.length = 0
    sessionQa = []
    lastQuestion = ''
    lastQuestionAt = 0
    sessionStartedAt = Date.now()
    listen.start()
    tracker.record('session_started', { mode: 'meeting', transcription: stt.provider })
    return { ...stt, killSwitch: registry.isKilled() }
  })
  handle('listen:stop', async () => {
    // Give answers already streaming a moment to land in the session's Q&A.
    await waitForAnswers(3000)
    return listen.stop('user')
  })
  handle('listen:chunk', (_, bytes: Uint8Array, mime: string, s: number, e: number) =>
    listen.pushChunk(new Uint8Array(bytes), mime, s, e)
  )
  handle('listen:text', (_, text: string, s: number, e: number) => {
    if (typeof text !== 'string' || text.length > 5000) return
    listen.pushText(text, Number(s) || 0, Number(e) || 0)
  })

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

// In `npm run dev`, electron-vite serves the renderer and sets ELECTRON_RENDERER_URL;
// otherwise load the built files.
function loadPage(win: BrowserWindow, page: 'main' | 'overlay') {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && !app.isPackaged) void win.loadURL(`${devUrl}/${page}/index.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
}

// Neither window may navigate away or open new windows.
function lockDown(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (e) => e.preventDefault())
}

function registerHotkey(setting: string, fallback: string, action: () => void): void {
  const accelerator = readSetting<string>(setting, fallback)
  if (!accelerator) return
  try {
    // Registration fails quietly when another app already owns the shortcut.
    if (!globalShortcut.register(accelerator, action)) {
      tracker.record('hotkey_unavailable', { setting, accelerator })
    }
  } catch {
    tracker.record('hotkey_unavailable', { setting, accelerator })
  }
}

// App-wide shortcuts. The overlay's own show/hide shortcut lives in overlay.ts.
function registerAppHotkeys(): void {
  const focusMain = () => {
    if (!mainWin || mainWin.isDestroyed()) return
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
  }
  registerHotkey('hotkey.listen', 'Control+Shift+L', () => {
    focusMain()
    sendMain('hotkey', 'toggleListen')
  })
  registerHotkey('hotkey.ask', 'Control+Shift+A', () => {
    focusMain()
    sendMain('hotkey', 'focusAsk')
  })
  registerHotkey('hotkey.vision', 'Control+Shift+V', () => {
    focusMain()
    sendMain('hotkey', 'vision')
  })
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
  loadPage(mainWin, 'main')

  overlay = createOverlay({
    hotkey: readSetting('hotkey.overlay', 'Control+Shift+Space'),
    preloadPath: join(__dirname, '../preload/overlay.js'),
    load: (win) => loadPage(win, 'overlay')
  })
  lockDown(overlay.window.webContents)
  registerAppHotkeys()

  // Closing the main window quits the app; the overlay alone has no taskbar entry or close button.
  mainWin.on('closed', () => {
    mainWin = null
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())

// Save a running session before quitting, and give a summary already in flight a
// short chance to land. The transcript is saved first, so a timeout loses only
// the generated summary, never the session.
let savingBeforeQuit = false
app.on('before-quit', (e) => {
  if (savingBeforeQuit) return
  if (!listen.isActive() && pendingSummaries.size === 0) return
  e.preventDefault()
  savingBeforeQuit = true
  void (async () => {
    if (listen.isActive()) await listen.stop('user').catch(() => undefined)
    if (pendingSummaries.size) {
      await Promise.race([
        Promise.allSettled([...pendingSummaries]),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000))
      ])
    }
    shuttingDown = true
    app.quit()
  })()
})

app.on('will-quit', () => {
  shuttingDown = true
  globalShortcut.unregisterAll()
  db.close()
})
