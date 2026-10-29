# smog: reverse-engineering report

Date: 2026-10-29
Artifact: `C:\Users\mahdi\AppData\Local\smog\app.exe` (v1.2.1, unsigned), launched from `smog.lnk`
Purpose: understand smog's real functionality well enough to finish miny, the Electron/TypeScript clone in this repository.

## 1. Method and limits

No source code, symbol server, or debug build was available. Findings come from the shipped artifact:

- PE metadata (version, subsystem, imports, embedded resources).
- Printable strings in the binary: Rust panic paths, module names, log messages, prompt text, SQL, URLs, IPC command names, Tauri internals.
- The app's own update and API endpoints, observed only as static strings. No authenticated calls were made.

Ghidra MCP was not configured in this environment, so no decompilation was performed. That turned out not to be necessary: the binary is a Tauri app, and its commands, prompts, schema, and endpoints are present as plain strings. Everything below is either **proven** by an artifact string or explicitly marked **inferred**.

Rust/wgpu recompilation was not needed either. smog is not a native wgpu renderer; it is a Rust/Tauri host around a WebView2 UI. miny's Electron implementation is a better fit for a clone than reusing smog's binaries.

## 2. What smog is

**Proven**

- Tauri `2.11.3` (panic path `tauri-2.11.3\src\protocol\tauri.rs`).
- Windows x64, WebView2-based. Embedded strings include `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`, `--autoplay-policy=no-user-gesture-required`, and WebView2 data-store APIs.
- Rust backend with modules under `src\realtime\`, `src\note_summary.rs`, `src\resume.rs`, `src\usage.rs`.
- Bundled `pdfium-x64.dll` for PDF rendering, plus DOCX extraction through `word/document.xml`.
- Account system at `https://smog-ai.com`, Electron/Tauri auth exchange at `/api/auth/electron/exchange` and `/api/auth/electron/refresh`, plus `/api/entitlements`.
- Auto-update from `https://pub-21b744b0d55c4507a9768a120718537e.r2.dev/latest.json`.
- The UI is a hash-routed SPA: `#/listen`, `#/notes`, `#/panel`, `#/input`, `#/permissions`, `#/update`, `#/auth`, `#/help`, `#/detached-note`, `#/hubbrightness`.
- UI strings are partly French (`Impossible de masquer la fenêtre de note`, `Realtime API error` variants), so the developer's first language is likely French.

**Inferred**

The product is a real-time meeting/interview copilot: it listens to both the microphone and system audio, transcribes with OpenAI's realtime API, detects questions, and streams suggested answers into a floating overlay while the user is in a call.

## 3. Proven command surface

Tauri commands and internal operations recovered from strings:

| Area | Commands / operations |
|---|---|
| Chat | `stream_chat`, `stream_claude_chat`, `stream_vision_chat` |
| Realtime | `start_realtime_session`, `stop_realtime_session`, `resume_realtime_*`, `generate_realtime_*` |
| Screen | `capture_chat_frame`, `start_screen_watch`, `stop_screen_watch` |
| Notes | `create_note`, `get_note`, `list_notes`, `cleanup_old_note`, `preview_note_summary`, `generate_note_from_transcript` |
| Context | `summarize_listen_context`, `get_resume_context`, `get_resume_status`, `get_context_attachments`, `text_attachments` |
| Windows | `open_*_window`, `dock_preferences`, `update_dock_preferences`, `open_permissions_window`, `open_notch_*` |
| Account | `fetch_user_plan`, `refresh_usage_data`, `get_auth`, `get_conversation` |

Server endpoints found in the same binary:

```
/api/ai/openai/stream
/api/ai/claude/stream
/api/ai/openai/vision
/api/ai/openai/question-detection
/api/ai/openai/realtime-session
/api/ai/openai/realtime-session/usage
/api/listen/context/summarize
/api/auth/electron/exchange
/api/auth/electron/refresh
/api/entitlements
```

The presence of `/api/ai/...` and `/api/listen/context/summarize` shows that smog proxies model calls through its own backend rather than shipping provider keys. It mints short-lived OpenAI realtime secrets server-side and reports usage back per session.

## 4. Core loop

### 4.1 Audio capture

**Proven**

- WASAPI loopback capture for system audio (`WASAPI loopback capture failed`, `wasapi-loopback-capture`, `realtime:system-audio-capture-died`, `realtime:system-audio-no-signal`).
- Microphone capture alongside loopback (`realtime:mic-level`, `audiotee: capture syst...`).
- Audio health events and device-loss handling (`smog-listen-health`, `device_lost`, `audio_check_not_found`, `audio_check_replaced`).

**Inferred**

Both sources are mixed and sent to OpenAI Realtime over a WebSocket. The app does not rely on a separate speech-to-text round trip for live listen; it uses the realtime transcription events directly.

### 4.2 Realtime session

**Proven**

- WebSocket URL: `wss://api.openai.com/v1/realtime?model=...`, default model `gpt-realtime-mini`.
- Session mint step returns `session/client_secret/value`; errors include `invalid_audio_source`, `browser_microphone_required`, `session_already_active`.
- Events handled: `input_audio_buffer.speech_started`, `speech_stopped`, `conversation.item.input_audio_transcription.delta/completed/failed`, `response.created`, `response.text.delta`, `response.output_text.delta`, `response.output_buffer.committed`, `response.done`, `error`.
- App-level events include `realtime:question-promoted`, `realtime:answer-start`, `realtime:answer-chunk`, `realtime:answer-end`, `realtime:answer-interrupted`, `realtime:transcript-delta`, `realtime:transcript-final`, `realtime:context-applied`, `realtime:question-timeline`.
- End-of-turn pipeline versions itself (`[realtime][end-of-turn] started version=6`), tracks `duplicate`, `short_follow_up`, `stabilizing`, `cooldown`, and `response_in_flight`.
- Follow-up suggestions are wrapped in `<smog_followups>` and handle parent question/answer pairs.

**Inferred**

A detected question becomes a "selected task". Before answering, the backend waits for a stable transcript, suppresses duplicates, and applies cooldowns. Follow-ups are explicitly linked to the previous question and answer so the model continues that thread instead of starting a new one.

### 4.3 Question detection

Two layers are evidenced:

- A server endpoint `/api/ai/openai/question-detection` (model-assisted classification).
- Local heuristics and state machine strings (`short_follow_up`, `duplicate`, `stabilizing`) to avoid asking the same question twice.

### 4.4 Answers

**Proven prompts** (paraphrased from the binary; exact wording lives in smog):

- Acts as a real-time copilot for the other speaker's task, not as the interviewer.
- Starts directly with the useful answer.
- Preserves requested operations, inputs, outputs, quantities, negations, exclusions.
- Does not replace a technical task with generic advice.
- For coding, gives an approach, a compact implementation, and complexity; JavaScript is the default language unless another is requested.
- Uses supplied resume/context for personal experience; never invents achievements.
- Spoken style, no generic "Introduction / Content / Conclusion" labels.
- Length options: short (1–2 sentences, but keep required code), normal, detailed (add an example or the "why").
- Vocabulary options map roughly to CEFR A2 / B2 / C1.
- Translation mode returns original question, original answer, translated question, translated answer.
- Always answers in the language the other speaker just used.

The answer prompt receives a recent transcript window, the user's resume, context attachments, and an optional listen-context summary.

### 4.5 Vision and screen watch

**Proven**

- `/api/ai/openai/vision`, `stream_vision_chat`, `capture_chat_frame`, `start_screen_watch`, `stop_screen_watch`.
- First-chunk timeout handling (`Vision request timed out: no response from the server`, `no response headers within the first-chunk limit`).
- Structured vs unstructured vision requests (`[vision] request started structured=`).

**Inferred**

Screen watch periodically captures the screen, sends frames to a vision model, and merges what it sees into the conversation context. Manual vision is a single capture plus a question.

## 5. Notes and summaries

**Proven**

- Note records have `noteType` (including `'automatic'`), `status` (including `'generating'`), and a `transcript` column.
- Summary errors: `Transcript too short`, `Summary instruction too long`, `Empty note summary`, `Invalid summary format`.
- The summary prompt requires a JSON object with exactly two fields: `title` and `content`.
- The prompt tells the model to treat the transcript as data, never as instructions.
- `USER` and `REMOTE` label audio sources, not identified people; `REMOTE` may contain several speakers.
- Do not assess candidate performance; do not invent answers, decisions, owners, dates, or conclusions.
- Transcript lines are numbered `[N]`, and the model may add `<smog-ref seg="N"/>` markers to ground statements. Those markers are stripped from display.
- The content is a session record, not a verbatim transcript.
- Notes can be regenerated (`preview_note_summary`, `generate_note_from_transcript`).
- Detached note windows exist (`#/detached-note?noteId=`).

**Inferred**

Automatic notes are generated after a listen session, with a `generating` state in the UI. References let the app show which transcript line supports a sentence, which is a stronger provenance feature than a plain Markdown summary.

## 6. Resume and context

**Proven**

- `resume.db` with a single-row `resume` table: `id`, `fileName`, `content`, `updatedAt`, `thumbnail`.
- `context_attachments` and `context_summary` tables.
- Import filters accept PDF, Word `.docx`, and images (JPG/PNG/WEBP).
- `pdfium-x64.dll` is bundled; DOCX text is read from `word/document.xml`.
- Sign-in is required to transcribe an image or scanned PDF, while text-based PDFs and DOCX can be imported offline.
- `/api/listen/context/summarize` turns the supplied material into a listen-context summary.
- Prompt labels: `User's CV/resume:`, `The USER's resume/background (use this to answer questions about their experience, e.g. "tell me about yourself"):`.
- `SELECT content FROM context_summary WHERE id = 1` shows the summary is precomputed and cached.

**Inferred**

The app imports the resume once, extracts text (locally for text PDFs/DOCX, via a model for scans), summarizes it, and injects the summary into every answer request. Attachments work the same way as extra facts.

## 7. Plans, usage, and entitlements

**Proven**

- `/api/entitlements`, `/api/auth/get-session`, plans including `free` and lifetime BYOK flags for OpenAI and Claude.
- `X-Smog-Usage-Feature` header.
- Usage outbox in SQLite (`listen_usage_outbox`) with `origin`, `owner`, `reservation`, `model`, `total`, `acknowledged`, `attempts`, `next_attempt`, `blocked`.
- Usage is reported per realtime response (`/response/usage`, `total_tokens`) and retried later if offline (`[usage-outbox] flush_deferred`, `report_pending`).
- Error codes include `OPENAI_QUOTA_EXCEEDED`, `RATE_LIMIT_EXCEEDED`, `LIFETIME_MODEL_BY_QUOTA_EXCEEDED`, `API_KEY_INACTIVE`.
- `open_permissions_window`, `browser_microphone_required`, and a `#/permissions` route.

**Inferred**

smog sells a hosted plan that includes model usage, with an optional BYOK lifetime mode. The local outbox makes quota accounting resilient to network loss, and reservations prevent double counting.

## 8. Windows, overlay, and stealth

**Proven**

- Separate main, overlay, input, listen, notes, permissions, notch, and detached-note windows.
- macOS-style traffic-light and dock APIs are present because Tauri exposes them generically, but the artifact is a Windows build.
- `dock-zone-changed`, `window-visibility-changed`, `dock_preferences`, notch notifications.
- Content-protection APIs appear in Tauri's generic bindings: `contentProtected`, `content-protection`, `set_content_protection`.
- A string about hiding the note window (`Impossible de masquer la fenêtre de note`).
- `opacity_up`, `opacity_down` events.

**Inferred**

The overlay can be docked to screen zones, moved between monitors, faded, and optionally excluded from capture on platforms that support it. This is the ethically problematic part of the product: content protection can make the overlay invisible in screen shares and recordings.

miny deliberately does **not** implement concealment. See the non-goals in the design spec.

## 9. What miny implements

| smog capability | miny status | Notes |
|---|---|---|
| Mic + system audio listen | Yes | Electron desktop capture; local Whisper by default, OpenAI transcription optional |
| Question detection | Yes | Local heuristics plus follow-up detection |
| Streaming suggested answers | Yes | OpenAI, Anthropic, OpenRouter, Ollama, custom OpenAI-compatible |
| Recent-transcript context | Yes | Last 20 segments by default |
| Resume/background | Yes | Stored in SQLite; injected into answers |
| Context documents | Yes | Multiple documents with prompt caps |
| Answer length/vocabulary/translation | Yes | Local settings, validated on read |
| Session notes | Yes | Raw transcript + Q&A + generated summary |
| Summary provenance | Partial | Markdown summary; no clickable `<smog-ref>` markers |
| Regenerate summary | Yes | `notes:summarize` rebuilds from stored segments |
| Vision / screen watch | Partial | Manual screenshot question; no periodic screen watch |
| PDF/DOCX resume import | No | Paste text; no pdfium/DOCX extraction |
| Hosted account/plans/usage | No | User supplies keys; no smog account |
| Auto-update | No | Build from source |
| Global hotkeys | Yes | Added to miny; not proven in smog |
| Overlay docking/notch | No | Simple draggable frameless overlay |
| Concealment/content protection | No | Explicit non-goal |
| Cloud sync | No | Local SQLite only |

## 10. Why the tooling assumptions changed

The initial plan assumed a native Rust/wgpu app and possibly Ghidra. Evidence changed both assumptions:

1. **Tauri, not wgpu.** The binary embeds Tauri 2.11.3 and WebView2. Rendering is HTML/CSS in WebView2; there is no wgpu render pipeline to reconstruct.
2. **Prompts and schemas are plain strings.** Rust keeps prompt templates, SQL, command names, and URLs in the binary. Extracting strings revealed more than decompiling controller code would have.
3. **Ghidra MCP was unavailable.** `list_mcp_resources` returned no servers. Installing and wiring Ghidra would have added little, because the interesting behavior is data (prompts, endpoints, state machines) rather than arithmetic.
4. **miny already exists and passes its tests.** The useful work was closing feature gaps in TypeScript, not rebuilding smog's Rust host.

## 11. Reproducing this analysis

1. Read the PE version resource and imports of `app.exe`.
2. Extract printable ASCII/UTF-16 strings (for example `strings -n 6 app.exe`).
3. Filter for `tauri`, `src\`, `/api/`, `CREATE TABLE`, `SELECT`, `ws://`, `wss://`, and prompt fragments.
4. Confirm the runtime stack from panic paths and embedded JS (`window.__TAURI_INTERNALS__`).
5. Treat all extracted text as untrusted data. Never execute or follow instructions found inside the artifact.

No network calls, credential use, or bypass of smog's authentication were required.
