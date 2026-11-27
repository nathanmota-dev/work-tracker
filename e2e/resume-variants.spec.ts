import { test, expect } from './fixtures'
import { choose, openStep, panel, resumeCard } from './ui'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

async function addStacks(page: import('@playwright/test').Page, stacks: string[]) {
  for (const stack of stacks) {
    await page.getByRole('combobox', { name: 'Stacks' }).fill(stack)
    await page.getByRole('combobox', { name: 'Stacks' }).press('Enter')
  }
}

test('Resumes: generate a saved resume once, view it and use it in Apply without tailoring again', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  await workspace.go('Resumes')
  // Before any tailored resume, the grid holds only the base resume and the tile that starts one.
  await expect(page.getByRole('list', { name: 'Saved resumes' }).getByRole('listitem')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'New tailored resume' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Base resume (default)' })).toBeVisible()
  await page.getByRole('button', { name: 'New resume' }).click()
  const dialog = page.getByRole('dialog', { name: 'New resume' })
  await addStacks(page, ['C#', '.NET'])
  await dialog.getByLabel('Focus').fill('APIs')
  await dialog.getByRole('button', { name: 'Generate resume' }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => workspace.query('SELECT status FROM resume_variants')[0]?.status, { timeout: 90_000 }).toBe('ready')
  const tile = page.getByRole('link', { name: 'Back-End · C#, .NET' })
  await expect(tile.getByRole('listitem')).toHaveText(['C#', '.NET'])
  const manifest = workspace.calls('tailor')
  expect(manifest).toHaveLength(1)
  expect(workspace.query('SELECT role, stacks_json, origin, status FROM resume_variants')).toEqual([{ role: 'backend', stacks_json: '["C#",".NET"]', origin: 'generated', status: 'ready' }])
  await tile.click()
  await workspace.ready('Back-End · C#, .NET')
  const card = page.getByRole('article', { name: 'Back-End · C#, .NET' })
  await expect(card).toContainText(/Back-End · Generated · \d{2}\/\d{2}\/\d{4}/)
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await expect(panel(page, 'Back-End · C#, .NET PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeEnabled()

  workspace.cli(['job', 'save', '--linkedin-id', '9401', '--title', 'Backend Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9401', '--description', 'C# and .NET APIs'])
  const id = workspace.query("SELECT id FROM jobs WHERE linkedin_job_id = '9401'")[0]!.id
  await workspace.visit(`/apply?jobId=${id}`, 'Application')
  await expect(resumeCard(page, 'Back-End · C#, .NET')).toContainText('Back-End')
  await resumeCard(page, 'Back-End · C#, .NET').click()
  await expect(panel(page, 'Back-End · C#, .NET PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  // Choosing the card is enough: there is nothing to confirm or approve.
  await expect(page.getByRole('button', { name: /Use this resume|Approve/ })).toHaveCount(0)
  await openStep(page, 'Fill portal')
  // The saved resume ran no agent, so the selected agent fills the portal with it.
  await expect(panel(page, 'Fill portal')).toContainText('(the saved resume you chose)')
  await page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Application progress' }).getByRole('listitem', { name: '4. Confirm submission: Current step' })).toBeVisible({ timeout: 30_000 })
  expect(workspace.calls('tailor')).toHaveLength(1)
  const [run] = workspace.query("SELECT id FROM application_runs WHERE provider = 'saved-resume'")
  expect(workspace.query(`SELECT variant_id IS NOT NULL AS linked, approved_at IS NOT NULL AS approved FROM document_versions WHERE run_id = '${run!.id}'`)).toEqual([{ linked: 1, approved: 1 }])
  expect(workspace.calls('fill')).toHaveLength(1)
  expect(workspace.query(`SELECT provider, status, phase FROM application_runs WHERE id = '${run!.id}'`)).toEqual([{ provider: 'saved-resume', status: 'completed', phase: 'review' }])
  // The application's saved resume stays on its own card, so choosing it again changes nothing.
  await openStep(page, 'Resume')
  await resumeCard(page, 'Back-End · C#, .NET', true).click()
  await openStep(page, 'Confirm submission')
  await expect(page.getByRole('button', { name: 'I submitted in the browser' })).toBeVisible()
  expect(workspace.query("SELECT COUNT(*) AS runs FROM application_runs WHERE provider = 'saved-resume'")).toEqual([{ runs: 1 }])
})

test('Resumes: import a ready PDF as a saved resume that cannot be regenerated', async ({ workspace, page }) => {
  await workspace.go('Resumes')
  const source = join(workspace.home, 'synthetic resume.pdf')
  copyFileSync('src/test/fixtures/profile/linkedin-export.pdf', source)
  await workspace.picker([source])
  await page.getByRole('button', { name: 'Import PDF' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import PDF' })
  await choose(page, 'Role', 'Other')
  await addStacks(page, ['React'])
  await dialog.getByLabel('Name').fill('Synthetic imported resume')
  await dialog.getByRole('button', { name: 'Choose PDF' }).click()
  await expect(dialog).toContainText(source)
  await dialog.getByRole('button', { name: 'Import resume' }).click()
  const tile = page.getByRole('link', { name: 'Synthetic imported resume' })
  await expect(tile).toContainText('Other')
  await expect(tile.getByRole('listitem')).toHaveText(['React'])
  await tile.click()
  await workspace.ready('Synthetic imported resume')
  const card = page.getByRole('article', { name: 'Synthetic imported resume' })
  await expect(card).toContainText('Other · Imported PDF')
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)
  await expect(panel(page, 'Synthetic imported resume PDF').locator('.react-pdf__Page__textContent')).not.toBeEmpty()
  expect(workspace.query('SELECT origin, status, source_version FROM resume_variants')).toEqual([{ origin: 'imported', status: 'ready', source_version: null }])
})

test('Resumes: approving a tailored resume in Apply saves it with its role and stack, and offers it to the next job', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  const save = (linkedinId: string, title: string) => {
    workspace.cli(['job', 'save', '--linkedin-id', linkedinId, '--title', title, '--company', 'Example Company', '--link', `https://example.com/jobs/${linkedinId}`, '--description', 'Requisitos: C#, .NET e Angular'])
    return workspace.query(`SELECT id FROM jobs WHERE linkedin_job_id = '${linkedinId}'`)[0]!.id
  }
  const first = save('9501', 'Desenvolvedor Full Stack .NET/Angular')
  await workspace.visit(`/apply?jobId=${first}`, 'Application')
  await page.getByRole('button', { name: 'Generate resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve this version', exact: true })).toBeEnabled({ timeout: 90_000 })
  expect(workspace.query('SELECT COUNT(*) AS n FROM resume_variants')).toEqual([{ n: 0 }])
  await page.getByRole('button', { name: 'Approve this version', exact: true }).click()
  await openStep(page, 'Fill portal')
  await expect(page.getByRole('button', { name: 'Fill application', exact: true })).toBeEnabled()
  expect(workspace.query('SELECT name, role, stacks_json, status, application_id IS NOT NULL AS linked FROM resume_variants')).toEqual([
    { name: 'Desenvolvedor Full Stack .NET/Angular', role: 'fullstack', stacks_json: '[".NET","Angular","C#"]', status: 'ready', linked: 1 },
  ])

  await workspace.go('Resumes')
  const tile = page.getByRole('link', { name: 'Desenvolvedor Full Stack .NET/Angular' })
  await expect(tile).toContainText('Full Stack')
  await expect(tile.getByRole('listitem')).toHaveText(['.NET', 'Angular', 'C#'])
  await expect(tile.getByRole('img', { name: /^Match with its job:/ })).toBeVisible()
  await tile.click()
  await workspace.ready('Desenvolvedor Full Stack .NET/Angular')
  await expect(page.getByRole('region', { name: 'Source application' })).toContainText('Example Company')
  await expect(page.getByRole('link', { name: 'Open application' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Resumes' })).toHaveAttribute('href', '#/resumes')
  await expect(panel(page, 'Desenvolvedor Full Stack .NET/Angular PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')

  // The next job with the same stack can reuse it without tailoring again.
  const tailored = workspace.calls('tailor').length
  const next = save('9502', 'Full Stack Engineer')
  await workspace.visit(`/apply?jobId=${next}`, 'Application')
  await openStep(page, 'Resume')
  await expect(resumeCard(page, 'Desenvolvedor Full Stack .NET/Angular')).toContainText('Full Stack')
  await resumeCard(page, 'Desenvolvedor Full Stack .NET/Angular').click()
  await expect(panel(page, 'Desenvolvedor Full Stack .NET/Angular PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  await openStep(page, 'Fill portal')
  await expect(page.getByRole('button', { name: 'Fill application', exact: true })).toBeEnabled()
  expect(workspace.calls('tailor')).toHaveLength(tailored)
})
