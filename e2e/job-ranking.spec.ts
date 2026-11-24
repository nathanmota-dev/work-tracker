import { test, expect } from './fixtures'
import { choose } from './ui'

test('Jobs: rank a selected batch with a synthetic agent, sort by score and summarize the run', async ({ workspace, page }) => {
  const save = (title: string, ...extra: string[]) =>
    workspace.cli(['job', 'save', '--title', title, '--company', 'Ranking Corp', '--link', `https://example.test/rank/${encodeURIComponent(title)}`, ...extra])
  save('Strong role', '--description', 'Build React interfaces. Synthetic score 82')
  save('Weak role', '--description', 'Maintain legacy reports. Synthetic score 40')
  save('Missing posting')
  save('Closed role', '--description', 'Synthetic score 99', '--deadline', '2000-01-01')
  await workspace.go('Jobs')
  await expect(page.getByRole('button', { name: 'Rank new roles' })).toBeVisible()
  await page.getByRole('button', { name: 'Select all filtered results (4)', exact: true }).click()
  await page.getByRole('button', { name: 'Rank selected', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Ranking plan' })).toHaveText('3 roles will be ranked, 0 deferred. Skipped: 1 expired by deadline.')

  // The skill opens in the agent panel while the page stays usable.
  const panel = page.getByRole('dialog', { name: 'Agent task' })
  await expect(panel.getByRole('heading', { name: 'Rank opportunities' })).toBeVisible()
  await panel.getByRole('button', { name: 'Run agent' }).click()
  await expect(panel.getByRole('log')).toContainText('Synthetic workflow completed.')
  expect(workspace.calls('prompt').at(-1)?.text).toMatch(/work-tracker-job-ranking skill to triage the selected jobs #\d+, #\d+, #\d+, #\d+\./)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()

  await expect(page.getByRole('status', { name: 'Ranking summary' })).toHaveText('Ranked 2 · 1 unreachable · 1 expired · 0 deferred. Run again to continue.')
  // The overall score and band are computed by Work Tracker, never by the agent.
  expect(workspace.query(`SELECT j.title, r.status, r.overall, r.verdict, r.fetch_attempts, r.last_error FROM job_rankings r
    JOIN jobs j ON j.id = r.job_id ORDER BY j.title`)).toEqual([
    { title: 'Missing posting', status: 'unreachable', overall: null, verdict: null, fetch_attempts: 1, last_error: '404 Not Found' },
    { title: 'Strong role', status: 'scored', overall: 82, verdict: 'Strong Fit', fetch_attempts: 0, last_error: null },
    { title: 'Weak role', status: 'scored', overall: 40, verdict: 'Weak Fit', fetch_attempts: 0, last_error: null },
  ])
  await expect(page.getByText('82 · Strong fit')).toBeVisible()
  await expect(page.getByText('40 · Weak fit')).toBeVisible()
  await expect(page.getByText('Unreachable (attempt 1)')).toBeVisible()
  await expect(page.getByText('Expired (deadline passed)')).toBeVisible()

  await choose(page, 'Sort jobs', 'Sort: Highest score')
  const views = page.getByRole('button', { name: /^View / })
  await expect(views.nth(0)).toHaveAccessibleName('View Strong role')
  await expect(views.nth(1)).toHaveAccessibleName('View Weak role')

  await views.nth(0).click()
  const ranking = page.getByRole('dialog', { name: 'Strong role' }).getByRole('region', { name: 'Triage ranking' })
  await expect(ranking).toContainText('Triage: 82 · Strong fit')
  await expect(ranking).toContainText('No synthetic Kubernetes experience')
  await expect(ranking).toContainText('from the posting text only')
})
