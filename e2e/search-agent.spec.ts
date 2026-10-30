import { choose, panel } from './ui'
import { test, expect } from './fixtures'

test('Jobs: assessed search runs in the contextual panel with all criteria', async ({ workspace, page }) => {
  await workspace.go('Jobs')
  await page.getByLabel('Keywords').fill('React')
  await page.getByLabel('Location', { exact: true }).fill('Brazil')
  await choose(page, 'Work arrangement', 'Remote')
  await page.getByLabel('Pages to search').fill('2')
  await page.getByLabel('Assess fit with agent', { exact: true }).check()
  await page.getByRole('button', { name: 'Search with agent' }).click()
  const agent = page.getByRole('dialog', { name: 'Agent task' })
  await expect(agent).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible()
  await expect(agent.getByLabel('Role, keywords or job URL')).toHaveValue('React')
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByRole('log')).toContainText('Synthetic workflow completed.')
  expect(workspace.calls('prompt')[0]?.text).toContain('Work arrangement: remote. Pages to search: 2.')
  await agent.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'New (1)' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('1 saved · 0 already saved · 0 failed')).toBeVisible()
  expect(workspace.query('SELECT shortlisted_at FROM jobs')).toEqual([{ shortlisted_at: null }])
  await workspace.go('Dashboard')
  await expect(panel(page, 'Latest activity')).toContainText('Synthetic workflow completed')
})

test('Search: people/company filters, empty results, errors and retry', async ({ workspace, page }) => {
  await workspace.go('Search')
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
  ['job-scout', 'Role, keywords or job URL', 'React', 'Jobs', 'React Engineer'],
  ['deep-scout', 'Role, keywords or job URL', 'https://example.com/jobs/9001', 'Jobs', 'React Engineer'],
  ['profile-optimizer', 'LinkedIn username', 'synthetic-candidate', 'Profile', '88 / 100'],
  ['recruiter-outreach', 'Target company', 'Example Company', 'Recruiters', 'Alex Recruiter'],
  ['outreach-tracker', '', '', 'Activity', 'Synthetic workflow completed'],
  ['experience-bank', '', '', 'Activity', 'Synthetic workflow completed'],
] as const
for (const [skill, field, input, destination, result] of skills) {
  test(`Launch: ${skill} runs through ACP and persists its result`, async ({ workspace, page }) => {
    await workspace.go('Agent')
    await choose(page, 'Skill', ({ 'job-scout': 'Discover opportunities', 'deep-scout': 'Assess a role', 'profile-optimizer': 'Audit your profile', 'recruiter-outreach': 'Find recruiters', 'outreach-tracker': 'Review follow-ups', 'portal-filler': 'Prepare an application', 'experience-bank': 'Capture experience' })[skill])
    await choose(page, 'Agent', 'Claude Code')
    await choose(page, 'Model', 'e2e-careful')
    if (field) await page.getByLabel(field, { exact: true }).fill(input)
    await page.getByLabel('Additional context').fill('Emphasize testing experience')
    await page.getByRole('button', { name: 'Run agent' }).click()
    await expect(page.getByText('Synthetic agent is working. Synthetic workflow completed.', { exact: true })).toBeVisible()
    const prompt = workspace.calls('prompt')[0]!
    expect(prompt.provider).toBe('claude-code')
    expect(prompt.model).toBe('e2e-careful')
    expect(prompt.text).toContain('Emphasize testing experience')
    if (input) expect(prompt.text).toContain(input)
    await page.getByText('Read LinkedIn profile', { exact: true }).click()
    await expect(page.getByText('Synthetic tool completed', { exact: true })).toBeVisible()
    await workspace.go(destination)
    if (destination === 'Recruiters') await expect(page.getByRole('button', { name: 'View Alex Recruiter' })).toBeVisible()
    else await expect(page.getByText(result, { exact: true }).first()).toBeVisible()
    if (skill === 'experience-bank') expect(workspace.query('SELECT summary FROM activity_log')).toHaveLength(1)
    await workspace.go('Agent')
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.getByText('Synthetic agent is working. Synthetic workflow completed.', { exact: true })).toHaveCount(0)
  })
}

test('Launch: errors, cancellation and retained sign-in retry', async ({ workspace, page }) => {
  await workspace.go('Agent')
  await choose(page, 'Skill', 'Assess a role')
  await page.getByLabel('Role, keywords or job URL').fill('https://example.com/jobs/synthetic')
  workspace.setScenario({ agent: 'error' })
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByText('Synthetic agent failure', { exact: true })).toBeVisible()
  workspace.setScenario({ agent: 'hold' })
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeDisabled()
  await expect(page.getByText('Read LinkedIn profile', { exact: true })).toBeVisible()
  await workspace.go('Jobs')
  await workspace.go('Agent')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeEnabled()
  await choose(page, 'Skill', 'Assess a role')
  await page.getByLabel('Role, keywords or job URL').fill('https://example.com/jobs/synthetic')
  workspace.setScenario({ agent: 'login' })
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByRole('button', { name: 'Retry after sign-in' })).toBeEnabled()
  const prompts = workspace.calls('prompt')
  workspace.setScenario({})
  await page.getByRole('button', { name: 'Retry after sign-in' }).click()
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeEnabled()
  expect(workspace.calls('prompt').at(-1)?.pid).toBe(prompts.at(-1)?.pid)
})

test('Launch: portal preparation opens Apply before any agent fills a document', async ({ workspace, page }) => {
  await workspace.go('Agent')
  await choose(page, 'Skill', 'Prepare an application')
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByRole('heading', { name: 'Apply', exact: true })).toBeVisible()
  expect(workspace.calls('prompt')).toEqual([])
})
