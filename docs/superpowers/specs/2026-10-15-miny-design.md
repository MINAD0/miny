# miny — Design Spec

Date: 2026-10-15
Status: Draft, awaiting user review

## 1. Goal

miny is a Windows desktop assistant for live meetings and interviews. It listens to the conversation, detects questions, and suggests answers through an LLM. It also takes notes. The feature set mirrors smog-ai.com, except for the concealment behavior listed in Non-goals.

Target platform for v1: Windows 10/11 (x64). macOS is out of scope for v1.

## 2. Non-goals

- **No concealment.** The overlay is never hidden from screen shares, recordings, or other call participants. Anything the user sees, the call can see if they share their screen. The user controls visibility with a local hotkey that hides and shows the overlay on their own screen.
- No bundled AI service. The user supplies their own provider keys.
- No cloud sync or multi-device sync in v1.
- No macOS build in v1.

## 3. Architecture

Electron app with three layers:

- **Main process (Node):** window management, global hotkeys, audio capture orchestration, SQLite storage, provider calls, secure key storage, tracking.
- **Preload script:** exposes a narrow, typed `window.miny` API through `contextBridge`. The renderer never gets raw Node or Electron APIs.
- **Renderer (React + TypeScript):** two windows, both built from one Vite project:
  - **Main window:** sessions, notes, settings, activity log.
  - **Overlay window:** transparent, frameless, always-on-top panel showing the live transcript and suggested answers.

Modules (each one has a single purpose and a typed interface):

| Module | Responsibility | Depends on |
|---|---|---|
| `capture/` | Microphone and system-audio (WASAPI loopback) capture, screenshot capture | Electron desktopCapturer, native audio |
| `transcription/` | `Transcriber` interface; OpenAI transcription adapter (default) | `providers/http` |
| `providers/` | `LLMProvider` interface; adapters for OpenAI, Anthropic, and OpenAI-compatible endpoints (OpenRouter, Ollama, custom) | `providers/http` |
| `session/` | Listen session state, rolling transcript window, question detection, suggestion requests | `transcription`, `providers` |
| `notes/` | Note store: create, edit, folders, tags, favorites, archive, search, export | `storage` |
| `storage/` | SQLite access via better-sqlite3, schema migrations | none |
| `secrets/` | API key storage via Electron `safeStorage` (Windows DPAPI) | none |
| `tracking/` | Event recording, consent state, local activity log | `storage` |
| `settings/` | Non-secret settings: provider choice, model names, hotkeys, modes | `storage` |

## 4. Data flow

1. The user starts a Listen session. `capture/` produces audio chunks (about 5 seconds each) from the microphone and system loopback.
2. `transcription/` sends each chunk to the configured speech-to-text provider and returns text segments with timestamps.
3. `session/` appends segments to the transcript and detects questions. Detection is a cheap heuristic first (question marks, interrogative openers, a trailing "?" in the segment). Each detected question triggers one suggestion request.
4. A suggestion request sends the question plus the last N transcript segments (default N = 20) to the configured LLM through `providers/`. The response streams into the overlay.
5. Manual Ask: the user types or push-to-talks a question. It goes through the same path, with or without the live transcript as context.
6. Vision: a hotkey captures the screen. The image goes to a vision-capable model with the question. If the selected model does not accept images, Vision is disabled and the UI says why.
7. When a session stops, `notes/` saves an automatic note containing the transcript and the suggestions.

## 5. Provider configuration

- **LLM providers:** OpenAI, Anthropic (Claude), and OpenAI-compatible endpoints. OpenRouter is an OpenAI-compatible endpoint with a different base URL, so it reuses that adapter. Free OpenRouter models work the same way. Users may also point the adapter at a local server such as Ollama.
- Each provider has: base URL, API key (stored in `secrets/`), and model name. Users can add more than one provider and switch between them.
- Model capabilities (vision support, context length) are declared per model in a configuration file. The app disables features the chosen model cannot support.
- **Speech-to-text is a separate setting.** Anthropic has no transcription API, and OpenRouter's audio support is limited, so the transcription provider is chosen on its own. v1 ships an OpenAI transcription adapter. Other transcription providers follow the same `Transcriber` interface.

## 6. Storage

SQLite, one file in the user's app-data folder.

- `notes(id, title, body_md, folder_id, favorite, archived, created_at, updated_at, session_id)`
- `folders(id, name, parent_id)`
- `tags(id, name)` and `note_tags(note_id, tag_id)`
- `sessions(id, started_at, ended_at, mode, provider, model)`
- `segments(id, session_id, t_start, t_end, text)`
- `events(id, name, props_json, created_at)`: the local activity log
- `settings(key, value_json)`

API keys are never written to SQLite or any plain config file. They are encrypted with `safeStorage` and stored separately.

Full-text search uses SQLite FTS5 over `notes.title` and `notes.body_md`.

## 7. Tracking and privacy

- Usage events (for example, session started, suggestion requested, provider error) are recorded to the local `events` table.
- Recording requires consent. Nothing is recorded before the user accepts on first launch, and the user can revoke consent at any time.
- The activity log page reads the local `events` table and shows what was processed, when, and which provider received it.
- Remote upload of events is off by default. If the user configures an endpoint, batched events are sent to it. The design does not include a PostHog or other third-party analytics SDK.
- A network kill switch in settings blocks all outbound provider and tracking requests. Notes and the activity log still work offline.

## 8. Error handling

- **Provider errors** (auth failure, rate limit, timeout, model unsupported): shown in the overlay as a short message. Rate limits retry with backoff, up to 3 times. Auth errors do not retry.
- **Audio device errors** (device removed, no loopback device): the session stops cleanly, keeps the transcript captured so far, and saves the partial note.
- **Storage errors:** shown in the main window. Writes are wrapped in transactions so a failed write does not corrupt notes.

## 9. Testing

- **Unit (Vitest):** provider adapters with mocked HTTP responses (OpenAI, Anthropic, OpenAI-compatible), question detector, note store including FTS search, event batching and consent gating.
- **Integration:** a session pipeline test that feeds a recorded audio fixture through the transcriber stub and checks that suggestions are requested for detected questions.
- **End to end (Playwright with Electron):** create a note, edit, tag, search, export to Markdown; settings save; kill switch blocks requests.
- **Manual:** real audio capture on Windows with a live call, since loopback can't be fully automated.

## 10. Build order

Each phase is a working, testable milestone:

1. **Shell and storage:** Electron + React + TypeScript project, SQLite and migrations, secure key storage, settings screen.
2. **Notes:** note store, folders, tags, favorites, archive, search, Markdown export. Usable as a standalone notes app.
3. **Providers:** OpenAI, Anthropic, and OpenAI-compatible adapters with the provider settings UI.
4. **Listen:** audio capture, transcription, live transcript in the main window, automatic notes.
5. **Suggestions and Ask:** question detection, suggestion streaming, manual Ask.
6. **Overlay and Vision:** transparent overlay window, hotkey show/hide, screenshot Vision with capability checks.
7. **Tracking and activity log:** consent flow, event recording, activity log page, network kill switch.

## 11. Open items

- Default transcription model: OpenAI's transcription model, chosen at implementation time against current API docs.
- Default modes (interview, meeting) and their settings are defined in phase 5.
- Code signing and installer format (for example, NSIS) are deferred until after phase 7.
