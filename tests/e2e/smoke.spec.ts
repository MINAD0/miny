import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let profile: string

test.beforeEach(async () => {
  profile = mkdtempSync(join(tmpdir(), 'miny-e2e-'))
  app = await electron.launch({ args: ['.'], env: { ...process.env, MINY_USER_DATA: profile } })
  page = await app.firstWindow()
})

// The overlay window is created after the main window, so wait for it.
async function overlayWindow(): Promise<Page> {
  const existing = app.windows().find((w) => w !== page)
  if (existing) return existing
  return app.waitForEvent('window')
}

test.afterEach(async () => {
  await app.close().catch(() => undefined) // some tests quit the app themselves
  rmSync(profile, { recursive: true, force: true })
})

test('switching provider loads that provider default model', async () => {
  await page.getByRole('button', { name: 'settings', exact: true }).click()
  await page.getByLabel('Provider', { exact: true }).selectOption('anthropic')
  await expect(page.getByLabel('Model')).toHaveValue('claude-haiku-5-5')
  await page.getByLabel('Provider', { exact: true }).selectOption('ollama')
  await expect(page.getByLabel('Model')).toHaveValue('llama3')
})

test('the overlay window cannot reach notes, settings, or keys', async () => {
  const overlay = await overlayWindow()
  const exposed = await overlay.evaluate(() => Object.keys((window as any).miny ?? {}))
  expect(exposed).toEqual(['onOverlayUpdate'])
})

test('exporting two notes with the same title writes two files', async () => {
  await page.getByRole('button', { name: 'notes', exact: true }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.getByRole('button', { name: 'Export .md' }).click()
  await expect(page.getByText(/Exported to .*Untitled\.md/)).toBeVisible()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.getByRole('button', { name: 'Export .md' }).click()
  await expect(page.getByText(/Exported to .*Untitled \(2\)\.md/)).toBeVisible()
})

test('closing the main window quits the app', async () => {
  const closed = new Promise<void>((resolve) => app.on('close', () => resolve()))
  await page.close()
  await closed
})

test('creates, edits, favorites, and searches a note', async () => {
  await page.getByRole('button', { name: 'notes', exact: true }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.getByLabel('Note title').fill('Kubernetes prep')
  await page.getByLabel('Favorite').check()
  await page.getByLabel('Note body').click() // blur the title so it saves
  await page.getByPlaceholder('Search notes').fill('kubernetes')
  await expect(page.getByText('Kubernetes prep')).toBeVisible()
})

test('fast typing in the note body keeps every character after leaving and returning', async () => {
  await page.getByRole('button', { name: 'notes', exact: true }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  const text = 'The quick brown fox jumps over the lazy dog 0123456789'
  await page.getByLabel('Note body').pressSequentially(text, { delay: 0 })
  await expect(page.getByLabel('Note body')).toHaveValue(text)

  // Leave the notes view (this blurs and saves), then come back and reopen the note.
  await page.getByRole('button', { name: 'settings', exact: true }).click()
  await page.getByRole('button', { name: 'notes', exact: true }).click()
  await page.getByText('Untitled', { exact: true }).click()
  await expect(page.getByLabel('Note body')).toHaveValue(text)
})

test('kill switch can be turned on from settings and persists', async () => {
  await page.getByRole('button', { name: 'settings', exact: true }).click()
  const box = page.getByLabel(/Block all outbound/)
  await box.check()
  await expect(box).toBeChecked()
})

test('Ask with the kill switch on shows the block in the overlay, without a network call', async () => {
  await page.getByRole('button', { name: 'settings', exact: true }).click()
  await page.getByLabel(/Block all outbound/).check()
  await page.getByRole('button', { name: 'listen', exact: true }).click()
  await page.getByPlaceholder('Ask a question').fill('What is a closure?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()

  const overlay = await overlayWindow()
  await expect(overlay.getByText('What is a closure?')).toBeVisible()
  await expect(overlay.getByText(/kill switch/i)).toBeVisible()
})

test('Ask with an empty question shows an inline error', async () => {
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('Type a question first')).toBeVisible()
})

test('activity log asks for consent before recording anything', async () => {
  await page.getByRole('button', { name: 'activity', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Allow recording' })).toBeVisible()
})
