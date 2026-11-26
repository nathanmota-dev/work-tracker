import { test, expect, type Workspace } from './fixtures'
import { panel, jobMenu, openJob } from './ui'

const card = (workspace: Workspace) => panel(workspace.page, 'Get started')
const step = (workspace: Workspace, title: string) => card(workspace).locator('li[id^="get-started-"]').filter({ has: workspace.page.getByRole('heading', { name: new RegExp(`^\\d\\. ${title}$`) }) })
const progress = (workspace: Workspace, done: number) => expect(card(workspace)).toContainText(`${done} of 4 steps complete`)

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

test.describe('a workspace that has not finished setup', () => {
  test.use({ setup: false })

  test('Setup: the workspace opens only after an agent passes its test, then Get started leads to the first application', async ({ workspace, page }) => {
    test.setTimeout(180_000)
    // The app opens on the full-screen setup, never on the Dashboard.
    await expect(page.locator('[data-sidebar="sidebar"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Get started' }).click()
    await workspace.ready('Connect your agent')
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await expect(next).toBeDisabled()
    await expect(page.getByText('Test Claude Code or opencode to continue.')).toBeVisible()
    // Leaving the setup by URL brings it back.
    await page.evaluate(() => { location.hash = '/jobs' })
    await workspace.ready('Welcome to Work Tracker')
    await page.getByRole('button', { name: 'Get started' }).click()

    const agents = page.getByRole('radiogroup', { name: 'Agent' })
    await agents.getByRole('radio', { name: /opencode/ }).click()
    await expect(agents.getByRole('radio', { name: /opencode/ })).toContainText('Not tested')
    await page.getByRole('button', { name: 'Test agent' }).click()
    await expect(page.getByLabel('Diagnostic results')).toContainText('Using the provider default model')
    await expect(agents.getByRole('radio', { name: /opencode/ })).toContainText('Ready')
    await expect(next).toBeEnabled()
    // The MCP servers are not part of the setup.
    expect(workspace.query("SELECT target FROM integration_verifications")).toEqual([{ target: 'acp/opencode' }])

    for (const title of ['Find your next role', 'Apply with confidence', 'Keep it all moving', 'You’re all set! 🎉']) {
      await next.click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    }
    await page.getByRole('button', { name: 'Go to Dashboard' }).click()
    await workspace.ready('Dashboard')
    expect(workspace.query('SELECT setup_completed_at IS NOT NULL AS done FROM onboarding_state')).toEqual([{ done: 1 }])

    // The synthetic repository already holds a base resume, and the LaTeX tools are installed.
    await expect(step(workspace, 'Set up your base resume')).toContainText('Done')
    await progress(workspace, 1)
    await fillAnswers(workspace)
    await page.reload()
    await workspace.ready('Dashboard')
    await progress(workspace, 2)

    await step(workspace, 'Run your first search').getByRole('link', { name: 'Search jobs' }).click()
    // The checklist opens Jobs straight in its Discover opportunities view.
    await expect(page.getByRole('heading', { name: 'Discover opportunities', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByLabel('Keywords')).toBeFocused()
    await page.getByLabel('Keywords').fill('React')
    await page.getByRole('button', { name: 'Search LinkedIn' }).click()
    await expect(page.getByText('1 saved · 0 already saved · 0 failed')).toBeVisible()
    await workspace.go('Dashboard')
    await progress(workspace, 3)

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
})

test('Setup: a finished setup opens on the Dashboard after a restart and can be replayed from Settings', async ({ workspace }) => {
  test.setTimeout(120_000)
  await workspace.restart()
  await workspace.go('Settings')
  await workspace.page.getByRole('link', { name: 'Replay introduction' }).click()
  await workspace.ready('Welcome to Work Tracker')
  await workspace.page.getByRole('button', { name: 'Get started' }).click()
  // No agent passed its test in this workspace, so the replay waits for one as well.
  await expect(workspace.page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await workspace.visit('/dashboard', 'Dashboard')
})

test('Get started: tracking by hand keeps its progress after a restart and stays reachable from step links', async ({ workspace }) => {
  test.setTimeout(120_000)
  // Restarting replaces the window, so this test always reads workspace.page.
  await expect(step(workspace, 'Set up your base resume')).toContainText('Done')
  await progress(workspace, 1)
  await workspace.restart()
  await progress(workspace, 1)

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
  await workspace.visit('/dashboard?step=answers', 'Dashboard')
  await expect(step(workspace, 'Fill essential answers')).toHaveAttribute('aria-current', 'step')
  await expect(step(workspace, 'Fill essential answers')).toContainText('Done')
})
