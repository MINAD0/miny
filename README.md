# miny

A local-first desktop copilot for live meetings and interviews. miny listens to the conversation, spots questions, and streams a suggested answer into a floating overlay. It also records each session as a searchable note.

miny is an Electron/TypeScript reimplementation of the feature set found in [smog](https://smog-ai.com), with one deliberate difference: **it does not hide the overlay from screen shares, recordings, or other participants.** If you share your screen, people can see miny.

- Reverse-engineering notes: [`docs/smog-reverse-engineering.md`](docs/smog-reverse-engineering.md)
- Original design spec: [`docs/superpowers/specs/2026-10-15-miny-design.md`](docs/superpowers/specs/2026-10-15-miny-design.md)

## Features

- **Listen mode** captures the microphone and system audio, transcribes it, and detects questions as they are asked.
- **Suggested answers** stream in real time. Follow-up questions such as "and why?" stay attached to the question they follow.
- **Local transcription by default.** Whisper runs in the renderer through ONNX Runtime; audio does not leave the machine. OpenAI transcription is optional.
- **Bring your own model.** OpenAI, Anthropic, OpenRouter (including free models), and Ollama.
- **Resume and context documents** give answers the facts needed for "tell me about yourself" without inventing experience.
- **Answer style controls**: length, vocabulary level, and optional translation.
- **Session notes** keep the raw transcript, the questions and answers, and a generated summary. Summaries can be regenerated from stored segments.
- **Manual Ask** uses the rolling transcript, or no context if you uncheck it.
- **Vision** sends one screenshot plus your question to a vision-capable model.
- **Kill switch** blocks all outbound network calls.
- **Consent-based activity log.** Nothing is recorded until you opt in, and revoking consent wipes the history.

## Requirements

- Windows 10 or 11 (x64). macOS and Linux are not supported in this version.
- Node.js 22 or newer (Node 24/25 also work).
- npm.
- A model provider key, unless you use a local Ollama server. Local Whisper needs no key but downloads model weights on first use.

## Quick start

```powershell
git clone https://github.com/MINAD0/miny.git
cd miny
npm install
npm run dev
```

`npm install` also copies the ONNX Runtime WASM files used by local Whisper.

To build and run the production bundle:

```powershell
npm run build
npm start
```

## Usage

1. Open **Settings**, choose a provider, paste an API key, pick a model, and click **Save**. Use **Test connection** to verify it.
2. Optional: add your resume and any context documents under **Your background**, and choose an answer length, vocabulary, and translation target.
3. Go to **Listen** and click **Start listening**. On first use, local Whisper downloads its model.
4. Play the meeting or call audio through your speakers. miny captures both the microphone and system output.
5. Detected questions appear in the overlay with a streaming answer.
6. Click **Stop** to save the session. The note is written immediately with the raw transcript; a structured summary replaces the body when a provider is available.
7. Open **Notes** to search, edit, tag, favorite, archive, export, or regenerate the summary.

### Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Show/hide the overlay |
| `Ctrl+Shift+L` | Start or stop listening |
| `Ctrl+Shift+A` | Focus the Ask box |
| `Ctrl+Shift+V` | Ask about the current screen (uses the text already in the Ask box) |

Shortcuts can be changed by writing the `hotkey.*` settings in the database, but there is no shortcut editor yet. If another application owns a shortcut, miny records `hotkey_unavailable` in the activity log and keeps running.

## Providers and keys

| Provider | Key required | Notes |
|---|---|---|
| OpenAI | Yes | Chat, vision, and optional `gpt-4o-transcribe` transcription |
| Anthropic (Claude) | Yes | Chat and vision, depending on the model |
| OpenRouter | Yes | Live model list with free models marked, plus automatic backups when a free model is busy |
| Ollama | No | Local OpenAI-compatible server at `http://localhost:11434/v1` |

Keys are stored with Electron `safeStorage`, which uses Windows DPAPI. They are never written to the notes database or the renderer. The renderer only sees whether a key exists.

Transcription is configured separately from the answering provider, because Anthropic has no speech API and OpenRouter's audio support is limited.

## Privacy and safety

- **No bundled AI service.** Requests go directly from your machine to the provider you chose.
- **Local transcription.** With the default local Whisper provider, audio stays in the renderer process.
- **Local storage.** Notes, sessions, settings, and the opt-in activity log live in SQLite under `%APPDATA%\miny`.
- **Kill switch.** When enabled, miny refuses outbound model, model-list, and key-info requests.
- **No concealment.** The overlay is a normal always-on-top window. It is not excluded from screen capture, and miny does not attempt to hide from call participants.
- **Untrusted transcript handling.** Prompts instruct the model to treat transcript text as data, not as instructions. Session summaries are explicitly forbidden from inventing decisions or answers.
- **No account.** miny has no sign-in, subscription, entitlement, or usage reporting. You pay your provider directly.

## Development

```powershell
npm run dev        # Electron + Vite with hot reload
npm run build      # production build into out/
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests
npm run test:e2e   # Playwright Electron tests (run npm run build first)
```

The e2e suite launches the built app with `MINY_USER_DATA` pointed at a temporary profile, so it never touches your real notes.

### Project layout

```
src/
  main/         Electron main process
    capture/    microphone, system audio, screenshots
    context/    resume and context-document storage
    export/     Markdown export
    providers/  OpenAI-compatible, Anthropic, registry, capabilities
    session/    listen loop, question detection, prompts, summaries
    storage/    SQLite schema, notes, migrations
    tracking/   consent-based activity log
    transcription/ OpenAI transcription adapter
  preload/      narrow contextBridge API for the main window
  renderer/
    main/       Listen, Notes, Settings, Activity views
    overlay/    frameless answer panel
    whisper/    local Whisper worker
  shared/       types and validation used by both processes
tests/
  main/         Vitest unit tests
  e2e/          Playwright Electron tests
```

### Database

SQLite is migrated on startup, currently to schema version 2:

- `notes` plus FTS5 search, folders, tags, favorites, archive.
- `notes.transcript` and `notes.qa_json` keep the raw session record separate from the generated summary.
- `sessions` and `segments` store the timed transcript.
- `context_docs` stores one resume and any number of context documents.
- `events` stores the opt-in activity log.

## Limitations

- Windows only.
- The overlay cannot be excluded from screen capture, by design.
- Resume import is paste-only; PDF/DOCX extraction is not implemented.
- Screen watch is a single manual capture, not a periodic feed.
- No auto-update, account, plan, or usage dashboard.
- Summary references are plain Markdown; smog's per-sentence transcript references are not implemented.

## License

ISC
