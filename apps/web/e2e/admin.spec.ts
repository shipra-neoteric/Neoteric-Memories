import { expect, test } from '@playwright/test'

test('Master Admin can sign in and reach the dashboard', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@neotericproperties.demo')
  await page.getByLabel('Password').fill('NeotericDemo#2026')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/admin\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})

test('an event created by the demo seed is visible in the Events list', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('admin@neotericproperties.demo')
  await page.getByLabel('Password').fill('NeotericDemo#2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)

  await page.goto('/admin/events')
  await expect(page.getByText('Ganesh Chaturthi Celebration')).toBeVisible({ timeout: 10000 })
})
