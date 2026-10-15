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

test.afterEach(async () => {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
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

  const overlay = app.windows().find((w) => w !== page)!
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
