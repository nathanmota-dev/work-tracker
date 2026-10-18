import { expect, type Page, type Locator } from '@playwright/test'

export async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: new RegExp(`^${label}(?:$|\\s)`) }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  // A click during the open animation can select the option without closing the list.
  const listbox = page.getByRole('listbox')
  await expect(async () => {
    if (await listbox.count()) await page.keyboard.press('Escape')
    await expect(listbox).toHaveCount(0, { timeout: 500 })
  }).toPass()
}
export function panel(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) })
}
export async function closeDialog(page: Page) { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0) }
