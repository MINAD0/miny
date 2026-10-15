import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'

// Full Listen path with real audio: Chromium's fake microphone plays a spoken question
// (made with Windows text-to-speech), local Whisper transcribes it, and question
// detection sends it to the overlay. The profile is kept between runs so the Whisper
// model downloads only once (tests/.profiles is git-ignored).
const PROFILE = resolve('tests/.profiles/whisper')

async function listenTo(wav: string, language: string, expectWord: RegExp) {
  mkdirSync(PROFILE, { recursive: true })
  const app = await electron.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${resolve(wav)}`,
      '.'
    ],
    env: { ...process.env, MINY_USER_DATA: PROFILE }
  })
  try {
    await app.firstWindow()
    while (app.windows().length < 2) await app.waitForEvent('window')
    const titles = await Promise.all(app.windows().map((w) => w.title()))
    const page: Page = app.windows()[titles.indexOf('miny')]
    const overlay: Page = app.windows()[titles.indexOf('miny overlay')]

    // Default transcription is local Whisper; set the language explicitly.
    await page.getByRole('button', { name: 'settings', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Local Whisper/ })).toBeChecked()
    await page.getByLabel('Language').selectOption(language)
    await page.getByRole('button', { name: 'listen', exact: true }).click()

    await page.getByRole('button', { name: 'Start listening' }).click()
    await expect(page.getByTestId('listen-note')).toContainText('Transcribing locally', { timeout: 540_000 })

    // The transcript shows the words, in the spoken language.
    await expect(page.locator('main').getByText(expectWord).first()).toBeVisible({ timeout: 60_000 })
    // The question is detected and sent to the overlay.
    await expect(overlay.getByText(expectWord).first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByRole('button', { name: 'Start listening' })).toBeVisible({ timeout: 60_000 })

    // The session was saved as a note containing the transcript.
    await page.getByRole('button', { name: 'notes', exact: true }).click()
    await page.getByText(/^Session /).first().click()
    await expect(page.getByLabel('Note body')).toHaveValue(expectWord)
  } finally {
    await app.close().catch(() => undefined)
  }
}

test('local Whisper: an English spoken question is transcribed, detected, and saved', async () => {
  test.setTimeout(600_000)
  await listenTo('tests/fixtures/question.wav', 'en', /closure/i)
})

test('local Whisper: a French spoken question stays in French and is detected', async () => {
  test.setTimeout(600_000)
  await listenTo('tests/fixtures/question_fr.wav', 'fr', /projet/i)
})
