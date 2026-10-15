import { expect, type Page, type Locator } from '@playwright/test'

export async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: new RegExp(`^${label}(?:$|\\s)`) }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
export function panel(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) })
}
export async function closeDialog(page: Page) { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0) }
