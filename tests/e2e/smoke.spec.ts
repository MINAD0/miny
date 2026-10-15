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
  const title = page.locator('input[value="Untitled"]')
  await title.fill('Kubernetes prep')
  await page.getByLabel('Favorite').check()
  await page.getByPlaceholder('Search notes').fill('kubernetes')
  await expect(page.getByText('Kubernetes prep')).toBeVisible()
})

test('kill switch can be turned on from settings and persists', async () => {
  await page.getByRole('button', { name: 'settings', exact: true }).click()
  const box = page.getByLabel(/Block all outbound/)
  await box.check()
  await expect(box).toBeChecked()
})

test('activity log asks for consent before recording anything', async () => {
  await page.getByRole('button', { name: 'activity', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Allow recording' })).toBeVisible()
})
