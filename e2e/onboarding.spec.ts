import { test, expect, type Workspace } from './fixtures'
import { choose, panel, jobMenu, openJob } from './ui'

const card = (workspace: Workspace) => panel(workspace.page, 'Get started')
const step = (workspace: Workspace, title: string) => card(workspace).locator('li[id^="get-started-"]').filter({ has: workspace.page.getByRole('heading', { name: new RegExp(`^\\d\\. ${title}$`) }) })
const progress = (workspace: Workspace, done: number) => expect(card(workspace)).toContainText(`${done} of 5 steps complete`)

/** Follow the answers step until every essential answer is saved. */
async function fillAnswers(workspace: Workspace) {
  const { page } = workspace
  for (const [label, value] of [['First name', 'Ada'], ['Last name', 'Lovelace'], ['Email', 'ada@example.com']] as const) {
    await step(workspace, 'Fill essential answers').getByRole('link', { name: 'Add answers' }).click()
    // The requested field opens in place above the questions.
    const editor = page.getByRole('region', { name: /answer/ })
    await expect(editor.getByLabel('Field', { exact: true })).toHaveText(label)
    await editor.getByLabel('Answer', { exact: true }).fill(value)
    await editor.getByRole('button', { name: 'Save answer' }).click()
    await expect(editor).toHaveCount(0)
    await workspace.go('Dashboard')
  }
  await expect(step(workspace, 'Fill essential answers')).toContainText('Done')
}

test('Get started: a new workspace reaches its first prepared application by following only the checklist', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  // The synthetic repository already holds a base resume, and the LaTeX tools are installed.
  await expect(step(workspace, 'Set up your base resume')).toContainText('Done')
  await progress(workspace, 1)
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('Agent (opencode ACP): not tested yet')

  await step(workspace, 'Connect your agent and integrations').getByRole('link', { name: 'Open integrations' }).click()
  // The agent is tested in Agent › Setup; MCP servers in Settings › Integrations.
  await workspace.ready('Agent')
  await expect(page.getByRole('combobox', { name: /^Agent(?:$|\s)/ })).toContainText('opencode ACP')
  await page.getByRole('button', { name: 'Test agent' }).click()
  await expect(page.getByLabel('Diagnostic results')).toContainText('Using the provider default model')
  await workspace.visit('/settings?section=integrations', 'Settings')
  await choose(page, 'Integration', 'LinkedIn MCP')
  await page.getByRole('button', { name: 'Test saved integration' }).click()
  await expect(page.getByLabel('Diagnostic results')).toContainText('separate LinkedIn session answered')
  await workspace.go('Dashboard')
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('Chrome MCP: not tested yet')
  // A diagnostic finishing elsewhere completes the step without reloading the Dashboard.
  await page.evaluate(() => window.desktop!.request('integrations/test', { target: 'mcp/chrome', model: '' }))
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('Done')
  await progress(workspace, 2)

  await fillAnswers(workspace)
  await page.reload()
  await workspace.ready('Dashboard')
  await progress(workspace, 3)

  await step(workspace, 'Run your first search').getByRole('link', { name: 'Search jobs' }).click()
  // The checklist opens Jobs straight in its Discover opportunities view.
  await expect(page.getByRole('heading', { name: 'Discover opportunities', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByLabel('Keywords')).toBeFocused()
  await page.getByLabel('Keywords').fill('React')
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByText('1 saved · 0 already saved · 0 failed')).toBeVisible()
  await workspace.go('Dashboard')
  await progress(workspace, 4)

  await step(workspace, 'Prepare your first application').getByRole('link', { name: 'Open the shortlist' }).click()
  await workspace.ready('Jobs')
  await expect(page.getByRole('tab', { name: 'Shortlist (0)' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('No roles yet')).toBeVisible()
  await page.getByRole('tab', { name: 'New (1)' }).click()
  await jobMenu(page, 'React Engineer', 'Move to shortlist')
  await page.getByRole('tab', { name: 'Shortlist (1)' }).click()
  await openJob(page, 'React Engineer')
  await page.getByRole('dialog', { name: 'React Engineer' }).getByRole('button', { name: 'Apply', exact: true }).click()
  await workspace.ready('Application')
  await page.locator('summary', { hasText: /^Job description$/ }).click()
  await page.getByLabel('Job description', { exact: true }).fill('React, TypeScript and testing')
  await page.getByRole('button', { name: 'Save description' }).click()
  await page.getByRole('button', { name: 'Generate resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve this version', exact: true })).toBeEnabled({ timeout: 90_000 })

  await workspace.go('Dashboard')
  await expect(card(workspace).getByRole('status')).toContainText('You’re all set.')
  await expect(card(workspace)).toHaveCount(0, { timeout: 10_000 })
  expect(workspace.query('SELECT hidden, completed_at IS NOT NULL AS completed FROM onboarding_state')).toEqual([{ hidden: 1, completed: 1 }])
})

test('Get started: manual tracking starts without an agent and keeps its choices after a restart', async ({ workspace }) => {
  test.setTimeout(120_000)
  // Restarting replaces the window, so this test always reads workspace.page.
  await card(workspace).getByRole('button', { name: 'Start without an agent' }).click()
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('Skipped')
  await workspace.restart()
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('Skipped')
  await progress(workspace, 2)

  // Empty lists point at the next step of the trail.
  await workspace.go('Jobs')
  await expect(workspace.page.getByText('No roles yet')).toBeVisible()
  await expect(workspace.page.getByRole('link', { name: 'Fill essential answers' })).toHaveAttribute('href', '#/dashboard?step=answers')
  await workspace.go('Dashboard')
  await fillAnswers(workspace)

  await workspace.go('Jobs')
  await workspace.page.getByRole('button', { name: 'Add job', exact: true }).click()
  const dialog = workspace.page.getByRole('dialog', { name: 'Add job' })
  await dialog.getByLabel('Role title').fill('Manual Engineer')
  await dialog.getByLabel('Company name').fill('Manual Company')
  await dialog.getByLabel('Job link').fill('https://manual.example/jobs/6')
  await dialog.getByRole('button', { name: 'Save job' }).click()
  await expect(workspace.page.getByRole('dialog').getByRole('button', { name: 'Edit job' })).toBeVisible()
  await workspace.page.keyboard.press('Escape')

  await workspace.go('Applications')
  await workspace.page.getByRole('button', { name: 'New application', exact: true }).first().click()
  await workspace.page.getByLabel('Company name', { exact: true }).fill('Sent Company')
  await workspace.page.getByLabel('Job link', { exact: true }).fill('https://manual.example/jobs/7')
  await workspace.page.getByRole('button', { name: 'Save application' }).click()
  await expect(workspace.page.getByRole('dialog')).toHaveCount(0)

  await workspace.go('Dashboard')
  await expect(card(workspace).getByRole('status')).toContainText('You’re all set.')
  await expect(card(workspace)).toHaveCount(0, { timeout: 10_000 })
  expect(workspace.calls('prompt')).toHaveLength(0)
  await workspace.restart()
  await expect(card(workspace)).toHaveCount(0)
  // A step link still opens the hidden checklist at that step.
  await workspace.visit('/dashboard?step=connect', 'Dashboard')
  await expect(step(workspace, 'Connect your agent and integrations')).toHaveAttribute('aria-current', 'step')
  await step(workspace, 'Connect your agent and integrations').getByRole('button', { name: 'Resume step' }).click()
  await expect(step(workspace, 'Connect your agent and integrations')).toContainText('To do')
})
