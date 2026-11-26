import { expect, type Page, type Locator } from '@playwright/test'
import type { Workspace } from './fixtures'

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

/** A saved job's card on Jobs, named by its title. */
export function jobCard(page: Page, title: string): Locator {
  return page.getByRole('article', { name: title, exact: true })
}
/** Opens a job's ⋯ menu (on its card, or inside `scope` such as the details) and picks an item. */
export async function jobMenu(page: Page, title: string, item: string, scope: Page | Locator = page) {
  await scope.getByRole('button', { name: `More actions for ${title}`, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
export async function openJob(page: Page, title: string) {
  await page.getByRole('button', { name: `View details of ${title}`, exact: true }).click()
}
/** Picks an option of a Jobs filter pill (Work type, Score or Sort). */
export async function filterJobs(page: Page, filter: 'Work type' | 'Score' | 'Sort', option: string) {
  await page.getByRole('button', { name: new RegExp(`^${filter}:`) }).click()
  await page.getByRole('menuitemradio', { name: option, exact: true }).click()
}
/** Titles of the job cards in their on-screen order. */
export async function jobOrder(page: Page): Promise<string[]> {
  return (await page.getByRole('article').evaluateAll(cards => cards.map(card => card.getAttribute('aria-label') ?? '')))
}
/** The floating bar of bulk actions, shown while jobs are selected. */
export function selectionBar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Selection actions' })
}
/** Selects one job, then every job the filters show. */
export async function selectAllJobs(page: Page, first: string, total: number) {
  await page.getByRole('checkbox', { name: `Select ${first}`, exact: true }).click()
  if (total > 1) await selectionBar(page).getByRole('button', { name: `Select all ${total}`, exact: true }).click()
  await expect(selectionBar(page).getByRole('status')).toHaveText(`${total} selected`)
}

/** The global agent panel, opened from the sidebar; opening is idempotent, and a closing panel still looks visible. */
export async function agentPanel(page: Page): Promise<Locator> {
  const agent = page.getByRole('dialog', { name: 'Agent task' })
  await page.getByRole('button', { name: 'Open agent task' }).click()
  await expect(agent).toBeVisible()
  return agent
}
/** Prepares an agent task as a user does: Profile's "Update experiences" opens the agent panel, ready to run. */
export async function prepareAgentTask(workspace: Workspace): Promise<Locator> {
  await workspace.visit('/profile', 'Profile')
  await workspace.page.getByRole('button', { name: 'Update experiences', exact: true }).click()
  return agentPanel(workspace.page)
}
