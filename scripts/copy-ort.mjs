// Copies the ONNX Runtime WASM files into the renderer's public folder, so local
// Whisper runs from files bundled with the app instead of loading code from a CDN.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const from = join('node_modules', 'onnxruntime-web', 'dist')
const to = join('src', 'renderer', 'public', 'ort')
mkdirSync(to, { recursive: true })

// The asyncify build is the one Transformers.js uses for WASM (it would otherwise fetch it from a CDN).
const files = readdirSync(from).filter((f) => /^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f))
for (const f of files) copyFileSync(join(from, f), join(to, f))
console.log(`copied ${files.length} ONNX Runtime files to ${to}`)
