import { test, expect, type Workspace } from './fixtures'

const name = (company: string) => `${company} Company · React Engineer`
const prompts = (workspace: Workspace) => workspace.calls('prompt').filter(call => String(call.text).includes('work-tracker-portal-filler')).length

test('Batch: a form in review, a pending sign-in and restarts keep the queue; an uncertain fill is never repeated blindly', async ({ workspace }) => {
  test.setTimeout(300_000)
  for (const [id, company] of [['9101', 'Alpha'], ['9102', 'Beta'], ['9103', 'Gamma']])
    workspace.cli(['job', 'save', '--linkedin-id', id!, '--title', 'React Engineer', '--company', `${company} Company`, '--link', `https://example.com/${company!.toLowerCase()}`])
  // The preparation queue lives in Applications; each item opens its application detail.
  await workspace.go('Applications')
  const request = (path: string, body: unknown) => workspace.page.evaluate(([path, body]) => window.desktop!.request(path, body), [path, body] as const) as Promise<{ id: string }>
  const item = (position: number, company: string) => workspace.page.getByRole('listitem', { name: `${position}. ${name(company)}` })
  const open = async (company: string, jobId: number) => {
    await workspace.page.getByRole('link', { name: `Open ${name(company)} application` }).click()
    await expect(workspace.page).toHaveURL(new RegExp(`jobId=${jobId}&`))
    await workspace.ready('Application')
  }
  const batch = await request('preparation-batches/create', { provider: 'opencode', items: [{ jobId: 1 }, { jobId: 2 }] })
  await expect(item(1, 'Alpha')).toContainText('Resume ready for review · needs you', { timeout: 90_000 })
  await expect(item(2, 'Beta')).toContainText('Resume ready for review · needs you', { timeout: 90_000 })
  workspace.setScenario({ agent: 'login' })
  await request('preparation-batches/add', { batchId: batch.id, items: [{ jobId: 3 }] })
  await expect(item(3, 'Gamma')).toContainText('Tailoring · waiting for sign-in', { timeout: 90_000 })
  workspace.setScenario({})

  // Approving a resume in its detail sends it to the fill phase; the filled form then reserves the portal.
  await open('Alpha', 1)
  await workspace.page.getByRole('button', { name: 'Approve this version', exact: true }).click()
  await workspace.go('Applications')
  await expect(item(1, 'Alpha')).toContainText('Form in review · needs you', { timeout: 60_000 })
  await expect(workspace.page.getByRole('status').filter({ hasText: `The browser portal is reserved for ${name('Alpha')}` })).toBeVisible()
  await open('Beta', 2)
  await workspace.page.getByRole('button', { name: 'Approve this version', exact: true }).click()
  await workspace.go('Applications')
  await expect(item(2, 'Beta')).toContainText('Waiting to fill · pending')
  // A manual fill cannot overwrite the form waiting for the candidate either.
  await workspace.page.goBack()
  await workspace.ready('Application')
  await workspace.page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(workspace.page.getByRole('alert')).toContainText(`The ${name('Alpha')} form is waiting for your review in the browser`)
  expect(workspace.calls('fill').map(call => call.applicationId)).toEqual([workspace.query("SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company_name = 'Alpha Company'")[0]!.id])

  await workspace.restart()
  await workspace.go('Applications')
  await expect(workspace.page.getByText('paused after restart', { exact: true })).toBeVisible()
  await expect(item(1, 'Alpha')).toContainText('Form in review · needs you')
  await expect(item(2, 'Beta')).toContainText('Waiting to fill · pending')
  await expect(item(3, 'Gamma')).toContainText('Tailoring · interrupted')
  await expect(item(3, 'Gamma')).toContainText('cannot be restored')
  await expect(workspace.page.getByRole('status').filter({ hasText: `The browser portal is reserved for ${name('Alpha')}` })).toBeVisible()

  // Confirming the submission releases the portal; the next fill is interrupted with an unknown outcome.
  await open('Alpha', 1)
  await workspace.page.getByRole('button', { name: 'I submitted in the browser' }).click()
  await expect(workspace.page.getByText(/Submission confirmed/)).toBeVisible()
  await workspace.go('Applications')
  await expect(item(1, 'Alpha')).toContainText('Submitted · completed')
  workspace.setScenario({ agent: 'hold' })
  const filled = prompts(workspace)
  await workspace.page.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(item(2, 'Beta')).toContainText('Filling the portal · running', { timeout: 60_000 })
  await expect.poll(() => prompts(workspace)).toBe(filled + 1)
  await workspace.restart()
  await workspace.go('Applications')
  await expect(item(2, 'Beta')).toContainText('Filling the portal · interrupted')
  await expect(workspace.page.getByRole('status').filter({ hasText: `The browser portal is reserved for ${name('Beta')}` })).toBeVisible()
  workspace.setScenario({})
  await workspace.page.getByRole('button', { name: 'Resume', exact: true }).click()
  await workspace.page.getByRole('button', { name: 'Retry failed', exact: true }).click()
  await expect(item(3, 'Gamma')).toContainText('Resume ready for review · needs you', { timeout: 90_000 })
  await expect(item(2, 'Beta')).toContainText('Filling the portal · interrupted')
  expect(prompts(workspace)).toBe(filled + 1)
  const retry = workspace.page.getByRole('button', { name: `Retry ${name('Beta')}` })
  await expect(retry).toBeDisabled()
  await item(2, 'Beta').getByRole('checkbox', { name: /I reviewed this portal/ }).check()
  await retry.click()
  await expect(item(2, 'Beta')).toContainText('Form in review · needs you', { timeout: 60_000 })
  expect(prompts(workspace)).toBe(filled + 2)
  expect(workspace.query('SELECT j.company_name, a.submission_status FROM applications a JOIN jobs j ON j.id = a.job_id ORDER BY j.id')).toEqual([
    { company_name: 'Alpha Company', submission_status: 'submitted' },
    { company_name: 'Beta Company', submission_status: 'not_submitted' },
    { company_name: 'Gamma Company', submission_status: 'not_submitted' },
  ])
  expect(workspace.query('SELECT COUNT(*) AS n FROM application_runs')).toEqual([{ n: 3 }])
})
