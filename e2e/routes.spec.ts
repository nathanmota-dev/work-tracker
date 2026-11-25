import { test, expect } from './fixtures'

// Explicit inventory: a new sidebar link must gain coverage, not be silently skipped.
export const routes = [
  ['Dashboard', 'dashboard', 'Saved opportunities'],
  ['Jobs', 'jobs', 'Discover opportunities'],
  ['Applications', 'applications', 'New application'],
  ['Interviews', 'interviews', 'Make space for the conversations that move you forward.'],
  ['Interview prep', 'interview-prep', 'Walk into every round with likely questions, grounded answers and a consistency brief.'],
  ['Contacts', 'contacts', 'Preview connection sync'],
  ['Profile', 'profile', 'Personal details'],
  ['Resumes', 'resumes', 'Your base resume and the resumes tailored from it for a role and stack, reused for every job that matches. Approving a tailored resume in Apply saves it here too.'],
  ['Agent', 'launch', 'Run a skill'],
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
        await expect(page.locator('[data-sidebar="sidebar"]').getByRole('group')).toHaveCount(4)
        expect(await page.locator('[data-sidebar="sidebar"]').getByRole('group').evaluateAll(groups =>
          groups.map(group => [group.getAttribute('aria-label'), Array.from(group.querySelectorAll('a')).map(link => link.getAttribute('aria-label'))])
        )).toEqual([
          ['Overview', ['Dashboard']], ['Journey', ['Jobs', 'Applications', 'Interviews', 'Interview prep', 'Contacts']],
          ['You', ['Profile', 'Resumes']],
          ['Tools', ['Agent', 'Settings']],
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
        if (populated && title === 'Jobs') await expect(page.getByRole('article').filter({ hasText: 'Company 1' }).first()).toBeVisible()
        if (populated && title === 'Interviews') await expect(page.getByRole('article', { name: 'Future Company', exact: true })).toBeVisible()
        if (populated && title === 'Applications') {
          await page.getByRole('radio', { name: 'Board', exact: true }).click()
          await expect(page).toHaveURL(/view=board/)
          await expect(page.getByRole('region', { name: 'Draft applications' })).toBeVisible()
          await page.reload()
          await workspace.ready(title)
          await expect(page.getByRole('radio', { name: 'Board', exact: true })).toHaveAttribute('aria-checked', 'true')
        }
      })
    }
  })
}

test('shell: redirect, sidebar, command palette, history and narrow window', async ({ workspace, page }) => {
  await expect(page).toHaveURL(/#\/dashboard\/?$/)
  await page.getByRole('button', { name: 'Alternar sidebar' }).click()
  await page.getByRole('button', { name: 'Buscar na navegação' }).click()
  await page.getByRole('combobox', { name: 'Search pages' }).fill('Profile')
  await page.keyboard.press('Enter')
  await workspace.ready('Profile')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search pages' }).fill('no such page')
  await expect(page.getByText('No pages found.')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search pages' }).fill('Settings')
  await page.getByRole('option').click()
  await workspace.ready('Settings')
  await page.goBack()
  await workspace.ready('Profile')
  await page.goForward()
  await workspace.ready('Settings')
  await workspace.resize(700)
  workspace.cli(['job', 'save', '--linkedin-id', '9700', '--title', 'Narrow Engineer', '--company', 'Narrow Company'])
  await workspace.visit('/apply?jobId=1', 'Application')
  await expect(page.getByRole('tab', { name: 'Base PDF' })).toBeVisible()
  await page.getByRole('tab', { name: 'Tailored PDF' }).click()
  await expect(page.getByRole('heading', { name: 'Tailored PDF', exact: true })).toBeVisible()
})

const readEndpoints = [
  ['Dashboard', 'overview'], ['Profile', 'answers/variants'], ['LinkedIn', 'profile'], ['Agent', 'acp/providers'],
  ['Recruiters', 'recruiters'], ['Outreach', 'outreach'],
  ['Jobs', 'jobs'], ['Applications', 'applications'],
  ['Answers', 'answers/variants'],
  ['Interviews', 'interviews'], ['Activity', 'activity'], ['Settings', 'acp/providers'],
] as const
for (const [title, endpoint] of readEndpoints) {
  test(`${title}: failed load can be retried`, async ({ workspace, page }) => {
    // The first Profile visit imports resume files and reloads its answers, which would retry the failure.
    if (title === 'Profile') await workspace.go('Profile')
    await workspace.go(title === 'Jobs' ? 'Settings' : 'Jobs')
    await workspace.fault(endpoint)
    // A failed request deliberately keeps its loader/error visible.
    const destinations: Record<string, [string, string]> = { Recruiters: ["/contacts?tab=people", "Contacts"], Outreach: ["/contacts?tab=follow-ups", "Contacts"], Answers: ["/profile?tab=answers", "Profile"], LinkedIn: ["/profile?tab=linkedin", "Profile"], Activity: ["/launch?tab=history", "Agent"] }
    if (destinations[title]) await page.evaluate(hash => { location.hash = hash }, destinations[title][0])
    else await page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: title, exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Synthetic transport failure' })).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).first().click()
    // Tabbed sections live inside their hub page.
    await workspace.ready(destinations[title]?.[1] ?? title)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}

test('legacy links: the board redirects to Applications and the detail stays reachable by URL', async ({ workspace, page }) => {
  await page.evaluate(() => { location.hash = '/application-board?q=Nothing' })
  await workspace.ready('Applications')
  await expect(page).toHaveURL(/#\/applications\?.*view=board/)
  await expect(page.getByLabel('Search applications')).toHaveValue('Nothing')
  await expect(page.locator('[data-sidebar="sidebar"] a[aria-current="page"]')).toHaveAccessibleName('Applications')
  await workspace.visit('/apply', 'Application')
  await expect(page.getByRole('link', { name: 'Open the Jobs shortlist' })).toBeVisible()
  await page.getByRole('link', { name: 'Open the Jobs shortlist' }).click()
  await workspace.ready('Jobs')
  await expect(page.getByRole('tab', { name: /^Shortlist/ })).toHaveAttribute('aria-selected', 'true')
})
