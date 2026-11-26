import type { Page } from '@playwright/test'
import { choose, panel } from './ui'
import { test, expect, type Workspace } from './fixtures'

test('Jobs: assessed search runs in the contextual panel with all criteria', async ({ workspace, page }) => {
  await workspace.go('Jobs')
  await page.getByRole('button', { name: 'Discover opportunities', exact: true }).click()
  await page.getByLabel('Keywords').fill('React')
  await page.getByLabel('Location', { exact: true }).fill('Brazil')
  await choose(page, 'Work arrangement', 'Remote')
  await page.getByLabel('Pages to search').fill('2')
  await page.getByLabel('Assess fit with agent', { exact: true }).check()
  await page.getByRole('button', { name: 'Search with agent' }).click()
  const agent = page.getByRole('dialog', { name: 'Agent task' })
  await expect(agent).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discover opportunities', exact: true, level: 1 })).toBeVisible()
  await expect(agent.getByRole('button', { name: 'Remove React' })).toBeVisible()
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByRole('log')).toContainText('Synthetic workflow completed.')
  expect(workspace.calls('prompt')[0]?.text).toContain('Work arrangement: remote. Pages to search: 2.')
  await agent.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'New (1)' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('1 saved · 0 already saved · 0 failed')).toBeVisible()
  expect(workspace.query('SELECT shortlisted_at FROM jobs')).toEqual([{ shortlisted_at: null }])
  await workspace.go('Dashboard')
  await expect(panel(page, 'Latest activity')).toContainText('Synthetic workflow completed')
  // The criteria survive a restart, so the next search starts from them.
  await workspace.restart()
  await workspace.visit('/jobs?discover=true', 'Discover opportunities')
  await expect(workspace.page.getByRole('button', { name: 'Remove React' })).toBeVisible()
  await expect(workspace.page.getByRole('button', { name: 'Remove Brazil' })).toBeVisible()
  await expect(workspace.page.getByRole('combobox', { name: /^Work arrangement/ })).toContainText('Remote')
})

test('Search: people/company filters, empty results, errors and retry', async ({ workspace, page }) => {
  await workspace.visit('/contacts?tab=find', 'Contacts')
  await page.getByLabel('Keywords').fill('Technical recruiter')
  await page.getByLabel('Company', { exact: true }).fill('Example Company')
  await page.getByLabel('Location', { exact: true }).fill('Brazil')
  workspace.setScenario({ mcp: 'error' })
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic LinkedIn failure')
  workspace.setScenario({ mcp: 'empty' })
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible()
  workspace.setScenario({ mcp: 'text' })
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await page.getByRole('button', { name: 'View Alex Recruiter' }).click()
  await expect(page.getByRole('dialog')).toContainText('Technical recruiter')
  expect(workspace.calls('mcp').filter(call => call.name === 'search_people').at(-1)?.arguments).toEqual({ keywords: 'Technical recruiter', location: 'Brazil', current_company: '1234' })
  await page.getByRole('button', { name: 'Open link' }).click()
  expect(await workspace.external()).toContain('https://www.linkedin.com/in/alex-recruiter/')
})

const skills = [
  ['job-scout', '', 'React', 'Jobs', 'React Engineer'],
  ['deep-scout', '', 'https://example.com/jobs/9001', 'Jobs', 'React Engineer'],
  ['profile-optimizer', 'LinkedIn username', 'synthetic-candidate', 'Profile', '88 / 100'],
  ['recruiter-outreach', 'Target company', 'Example Company', 'Recruiters', 'Alex Recruiter'],
  ['outreach-tracker', '', '', 'Activity', 'Synthetic workflow completed'],
  ['experience-bank', '', '', 'Activity', 'Synthetic workflow completed'],
] as const

/** Opens a skill's agent panel from the screen the skill belongs to; Jobs takes its search or role there. */
async function openSkill(workspace: Workspace, page: Page, skill: (typeof skills)[number][0], input: string) {
  if (skill === 'job-scout' || skill === 'deep-scout') {
    await workspace.visit(`/jobs?discover=true${skill === 'deep-scout' ? '&mode=assess' : ''}`, 'Discover opportunities')
    if (skill === 'deep-scout') {
      await page.getByLabel('Job link or title').fill(input)
      await page.getByRole('button', { name: 'Assess with agent' }).click()
      return
    }
    await page.getByLabel('Keywords').fill(input)
    await page.getByLabel('Assess fit with agent', { exact: true }).check()
    await page.getByRole('button', { name: 'Search with agent' }).click()
    return
  }
  const [hash, title, button] = {
    'profile-optimizer': ['/profile?tab=linkedin', 'Profile', 'Audit profile'],
    'recruiter-outreach': ['/contacts?tab=people', 'Contacts', 'Find recruiters'],
    'outreach-tracker': ['/contacts?tab=follow-ups', 'Contacts', 'Review follow-ups'],
    'experience-bank': ['/profile', 'Profile', 'Update experiences'],
  }[skill]
  await workspace.visit(hash, title)
  await page.getByRole('button', { name: button, exact: true }).first().click()
}

for (const [skill, field, input, destination, result] of skills) {
  test(`Agent panel: ${skill} starts from its screen, runs through ACP and persists its result`, async ({ workspace, page }) => {
    await openSkill(workspace, page, skill, input)
    const agent = page.getByRole('dialog', { name: 'Agent task' })
    await agent.getByText('Advanced', { exact: true }).click()
    await choose(page, 'Agent', 'Claude Code')
    await choose(page, 'Model', 'e2e-careful')
    if (field) await agent.getByLabel(field, { exact: true }).fill(input)
    await agent.getByLabel('Additional context').fill('Emphasize testing experience')
    await agent.getByRole('button', { name: 'Run agent' }).click()
    await expect(agent.getByText('Synthetic agent is working. Synthetic workflow completed.', { exact: true })).toBeVisible()
    const prompt = workspace.calls('prompt')[0]!
    expect(prompt.provider).toBe('claude-code')
    expect(prompt.model).toBe('e2e-careful')
    expect(prompt.text).toContain('Emphasize testing experience')
    if (input) expect(prompt.text).toContain(input)
    await agent.getByText('Read LinkedIn profile', { exact: true }).click()
    await expect(agent.getByText('Synthetic tool completed', { exact: true })).toBeVisible()
    await agent.getByRole('button', { name: 'Close', exact: true }).click()
    if (destination === "Recruiters") await workspace.visit("/contacts", "Contacts")
    else if (destination === "Activity") await workspace.visit("/launch?tab=history", "Agent")
    // The profile audit lands on the Profile's LinkedIn tab.
    else if (destination === "Profile") await workspace.visit("/profile?tab=linkedin", "Profile")
    else await workspace.go(destination)
    if (destination === 'Recruiters') await expect(page.getByRole('article', { name: 'Alex Recruiter' })).toBeVisible()
    else await expect(page.getByText(result, { exact: true }).first()).toBeVisible()
    if (skill === 'experience-bank') expect(workspace.query('SELECT summary FROM activity_log')).toHaveLength(1)
    await page.getByRole('button', { name: 'Open agent task' }).click()
    await agent.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(agent.getByText('Synthetic agent is working. Synthetic workflow completed.', { exact: true })).toHaveCount(0)
  })
}

test('Agent panel: errors, cancellation and retained sign-in retry', async ({ workspace, page }) => {
  await openSkill(workspace, page, 'deep-scout', 'https://example.com/jobs/synthetic')
  const agent = page.getByRole('dialog', { name: 'Agent task' })
  workspace.setScenario({ agent: 'error' })
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByText('Synthetic agent failure', { exact: true })).toBeVisible()
  workspace.setScenario({ agent: 'hold' })
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByRole('button', { name: 'Run agent' })).toBeDisabled()
  await expect(agent.getByText('Read LinkedIn profile', { exact: true })).toBeVisible()
  // The run continues while the panel is closed and another screen is open.
  await agent.getByRole('button', { name: 'Close', exact: true }).click()
  await workspace.go('Applications')
  await page.getByRole('button', { name: 'Open agent task' }).click()
  await agent.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(agent.getByRole('button', { name: 'Run agent' })).toBeEnabled()
  workspace.setScenario({ agent: 'login' })
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByRole('button', { name: 'Retry after sign-in' })).toBeEnabled()
  const prompts = workspace.calls('prompt')
  workspace.setScenario({})
  await agent.getByRole('button', { name: 'Retry after sign-in' }).click()
  await expect(agent.getByRole('button', { name: 'Run agent' })).toBeEnabled()
  expect(workspace.calls('prompt').at(-1)?.pid).toBe(prompts.at(-1)?.pid)
})
