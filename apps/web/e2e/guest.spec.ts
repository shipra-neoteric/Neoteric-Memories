import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readSeedOutput(): { events: { name: string; guestUrl: string }[] } {
  const p = path.join(__dirname, '..', '..', 'api', '.seed-output.json')
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

test('guest can scan the QR link, consent, upload a demo selfie, and see a matched photo', async ({ page }) => {
  const seed = readSeedOutput()
  const event = seed.events.find((e) => e.guestUrl.startsWith('http'))
  test.skip(!event, 'No fresh QR/link in .seed-output.json — run `npm run seed` or restart the API once first.')

  await page.goto(event!.guestUrl)
  await expect(page.getByRole('heading', { name: /Ganesh Chaturthi|Diwali|Janmashtami/ })).toBeVisible()
  await page.getByRole('button', { name: 'Find My Photos' }).click()

  await expect(page).toHaveURL(/\/consent$/)
  const checkboxes = page.locator('input[type="checkbox"]')
  const count = await checkboxes.count()
  for (let i = 0; i < count; i += 1) {
    const box = checkboxes.nth(i)
    if (!(await box.isChecked())) await box.check()
  }
  await page.getByRole('button', { name: /I agree/ }).click()

  await expect(page).toHaveURL(/\/selfie$/)
  const demoSelfiePath = path.join(__dirname, '..', '..', 'api', 'seed-assets', 'demo-selfies', 'person-1.jpg')
  await page.getByTestId('selfie-upload-input').setInputFiles(demoSelfiePath)

  await expect(page).toHaveURL(/\/results$/, { timeout: 15000 })
  await expect(page.getByText(/photo(s)? found/)).toBeVisible()
})
