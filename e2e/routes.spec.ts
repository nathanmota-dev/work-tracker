import { test, expect } from './fixtures'

// Explicit inventory: a new sidebar link must gain coverage, not be silently skipped.
export const routes = [
  ['Dashboard', 'dashboard', 'Saved opportunities'],
  ['Jobs', 'jobs', 'Discover opportunities'],
  ['Applications', 'applications', 'Tailor a resume'],
  ['Application board', 'application-board', 'New application'],
  ['Apply', 'apply', 'Opportunity'],
  ['Interviews', 'interviews', 'Upcoming'],
  ['Search', 'search', 'People & recruiters'],
  ['Recruiters', 'recruiters', 'Preview connection sync'],
  ['Outreach', 'outreach', 'Connection lifecycle'],
  ['Profile', 'profile', 'Profile assessment'],
  ['Answers', 'answers', 'Add answer'],
  ['Agent', 'launch', 'Run a skill'],
  ['Activity', 'activity', 'A running record of the steps you’ve taken. Showing the latest 50 events.'],
  ['Settings', 'settings', 'Appearance'],
] as const

for (const populated of [false, true]) {
  test.describe(populated ? 'populated workspace' : 'empty workspace', () => {
    test.use({ populated })
    for (const [title, path, content] of routes) {
      test(`${title}: navigation, content and reload`, async ({ workspace, page }) => {
        const links = page.locator('[data-sidebar="sidebar"]').getByRole('link')
        expect((await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href')!.split('#').at(-1)!.replace(/\/$/, ''))))).toEqual(routes.map(route => `/${route[1]}`))
        await expect(links).toHaveText(routes.map(route => route[0]))
        await expect(page.locator('[data-sidebar="sidebar"]').getByRole('group')).toHaveCount(6)
        expect(await page.locator('[data-sidebar="sidebar"]').getByRole('group').evaluateAll(groups =>
          groups.map(group => [group.getAttribute('aria-label'), Array.from(group.querySelectorAll('a')).map(link => link.getAttribute('aria-label'))])
        )).toEqual([
          ['Overview', ['Dashboard']], ['Find', ['Jobs']],
          ['Apply & track', ['Applications', 'Application board', 'Apply', 'Interviews']],
          ['People', ['Search', 'Recruiters', 'Outreach']], ['You', ['Profile', 'Answers']],
          ['Tools', ['Agent', 'Activity', 'Settings']],
        ])
        await workspace.go(title)
        await expect(page).toHaveURL(new RegExp(`#/${path}/?$`))
        await expect(page.locator('[data-sidebar="sidebar"] a[aria-current="page"]')).toHaveAccessibleName(title)
        await expect(page.getByRole('navigation', { name: 'Caminho da página' }).locator('[aria-current="page"]')).toHaveText(title)
        await expect(page.getByText(content, { exact: true }).first()).toBeVisible()
        await expect(page.getByRole('alert')).toHaveCount(0)
        await page.reload()
        await workspace.ready(title)
        await expect(page.getByText(content, { exact: true }).first()).toBeVisible()
        await expect(page.getByRole('alert')).toHaveCount(0)
        if (populated && title === 'Jobs') await expect(page.getByRole('cell', { name: 'Company 1', exact: false }).first()).toBeVisible()
        if (populated && title === 'Interviews') await expect(page.getByRole('cell', { name: 'Future Company', exact: true })).toBeVisible()
        if (!populated && title === 'Apply') await expect(page.getByRole('heading', { name: 'No PDF yet' })).toHaveCount(2)
      })
    }
  })
}

test('shell: redirect, sidebar, command palette, history and narrow window', async ({ workspace, page }) => {
  await expect(page).toHaveURL(/#\/dashboard\/?$/)
  await page.getByRole('button', { name: 'Alternar sidebar' }).click()
  await page.getByRole('button', { name: 'Buscar na navegação' }).click()
  await page.getByRole('combobox', { name: 'Search pages' }).fill('Answers')
  await page.keyboard.press('Enter')
  await workspace.ready('Answers')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search pages' }).fill('no such page')
  await expect(page.getByText('No pages found.')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search pages' }).fill('Settings')
  await page.getByRole('option').click()
  await workspace.ready('Settings')
  await page.goBack()
  await workspace.ready('Answers')
  await page.goForward()
  await workspace.ready('Settings')
  await workspace.resize(700)
  await workspace.go('Apply')
  await expect(page.getByRole('tab', { name: 'Base PDF' })).toBeVisible()
  await page.getByRole('tab', { name: 'Tailored PDF' }).click()
  await expect(page.getByRole('heading', { name: 'Tailored PDF', exact: true })).toBeVisible()
})

const readEndpoints = [
  ['Dashboard', 'overview'], ['Profile', 'profile'], ['Agent', 'acp/providers'],
  ['Recruiters', 'recruiters'], ['Outreach', 'outreach'], ['Apply', 'jobs'],
  ['Jobs', 'jobs'], ['Applications', 'applications'],
  ['Application board', 'application-board'], ['Answers', 'answers/variants'],
  ['Interviews', 'interviews'], ['Activity', 'activity'], ['Settings', 'acp/providers'],
] as const
for (const [title, endpoint] of readEndpoints) {
  test(`${title}: failed load can be retried`, async ({ workspace, page }) => {
    await workspace.go('Search')
    await workspace.fault(endpoint)
    // A failed request deliberately keeps its loader/error visible.
    await page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: title, exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic transport failure' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).first().click()
    await workspace.ready(title)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}
