import { test, expect } from './fixtures'

test('Requirement gates: declare languages, check jobs with the agent, hide the failed one and prepare it after confirming', async ({ workspace, page }) => {
  workspace.cli(['job', 'save', '--linkedin-id', '9101', '--title', 'Russian Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9101', '--description', 'Build React apps. Fluent Russian required.'])
  workspace.cli(['job', 'save', '--linkedin-id', '9102', '--title', 'English Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9102', '--description', 'Build React apps. Fluent English required.'])

  // Without declared languages or eligibility nothing can fail, and the page says how to turn the gates on.
  await workspace.go('Profile')
  await page.getByRole('tab', { name: 'Deal-breakers' }).click()
  await expect(page.getByText(/Both gates are off, so no job fails/)).toBeVisible()
  await expect(page.getByText(/An undeclared language counts as a hard no/)).toBeVisible()
  for (const [language, level] of [['Spanish', 'Native'], ['English', 'B1/B2']]) {
    await page.getByRole('textbox', { name: 'Language', exact: true }).fill(language)
    await page.getByRole('textbox', { name: 'Level', exact: true }).fill(level)
    await page.getByRole('button', { name: 'Add language' }).click()
    await expect(page.getByRole('list', { name: 'Declared languages' })).toContainText(language)
  }
  await page.getByRole('textbox', { name: 'Language', exact: true }).fill('spanish')
  await page.getByRole('textbox', { name: 'Level', exact: true }).fill('C1')
  await page.getByRole('button', { name: 'Add language' }).click()
  await expect(page.getByRole('alert')).toContainText('Spanish is already in your languages')
  expect(workspace.query('SELECT language, level FROM candidate_languages ORDER BY language_key')).toEqual([{ language: 'English', level: 'B1/B2' }, { language: 'Spanish', level: 'Native' }])

  // Both new jobs start unchecked; the synthetic agent stores a quoted extraction for each.
  await workspace.go('Jobs')
  await expect(page.getByRole('row', { name: /Russian Engineer/ })).toContainText('Not checked')
  await page.getByRole('button', { name: /^Select all filtered results/ }).click()
  await page.getByRole('button', { name: 'Check requirements' }).click()
  const agent = page.getByRole('dialog', { name: 'Agent task' })
  await expect(agent.getByRole('heading', { name: 'Check requirements' })).toBeVisible()
  await agent.getByRole('button', { name: 'Run agent' }).click()
  await expect(agent.getByRole('log')).toContainText('Synthetic workflow completed.')
  expect(workspace.calls('prompt').at(-1)?.text).toContain('work-tracker-requirements-check skill for these saved jobs:')
  await agent.getByRole('button', { name: 'Close', exact: true }).click()
  expect(workspace.query("SELECT title, json_extract(gate_json, '$.verdict') AS verdict FROM jobs ORDER BY title")).toEqual([
    { title: 'English Engineer', verdict: 'flag' }, { title: 'Russian Engineer', verdict: 'fail' },
  ])

  // New hides the failed job by default; it stays counted and comes back with the filter off.
  await expect(page.getByRole('row', { name: /English Engineer/ })).toContainText('Flag')
  await expect(page.getByRole('row', { name: /Russian Engineer/ })).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Failed jobs' })).toHaveText('(1 hidden)')
  await expect(page.getByRole('tab', { name: 'New (2)' })).toBeVisible()
  await page.getByRole('checkbox', { name: /Hide failed/ }).uncheck()
  const failed = page.getByRole('row', { name: /Russian Engineer/ })
  await expect(failed).toContainText('Fail')
  await failed.getByRole('button', { name: 'View Russian Engineer' }).click()
  const details = page.getByRole('dialog', { name: 'Russian Engineer' })
  await expect(details.getByRole('status', { name: 'Requirements check' })).toContainText('Requires Russian (fluent), which is not in your languages.')
  await expect(details.getByRole('status', { name: 'Requirements check' })).toContainText('Fluent Russian required.')

  // Preparing a failed job needs a second, explicit confirmation of the quoted warning.
  await details.getByRole('button', { name: 'Apply', exact: true }).click()
  await workspace.ready('Application')
  const warning = page.getByRole('alert', { name: 'Deal-breaker warning' })
  await expect(warning).toContainText('Fail: this job failed your deal-breakers.')
  await expect(warning).toContainText('Fluent Russian required.')
  await expect(page.getByRole('button', { name: 'Generate resume', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Review requirements' })).toBeVisible()
  await warning.getByRole('button', { name: 'Prepare anyway' }).click()
  await expect(warning).toContainText('You confirmed preparing this job anyway.')
  await expect(page.getByRole('button', { name: 'Review requirements' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate resume', exact: true })).toBeEnabled()
  expect(workspace.query("SELECT COUNT(*) AS n FROM jobs WHERE title = 'Russian Engineer' AND archived_at IS NULL")).toEqual([{ n: 1 }])
})
