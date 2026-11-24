import { test, expect } from './fixtures'
import { choose, panel } from './ui'
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
  await expect(page.getByText('No saved resumes yet')).toBeVisible()
  await page.getByRole('button', { name: 'New resume' }).click()
  const dialog = page.getByRole('dialog', { name: 'New resume' })
  await addStacks(page, ['C#', '.NET'])
  await dialog.getByLabel('Focus').fill('APIs')
  await dialog.getByRole('button', { name: 'Generate resume' }).click()
  await expect(dialog).toHaveCount(0)
  const card = page.getByRole('article', { name: 'Back-End · C#, .NET' })
  await expect(card.getByRole('button', { name: 'View' })).toBeVisible({ timeout: 90_000 })
  await expect(card).toContainText('Back-End · Generated · 2 pages')
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  const manifest = workspace.calls('tailor')
  expect(manifest).toHaveLength(1)
  expect(workspace.query('SELECT role, stacks_json, origin, status FROM resume_variants')).toEqual([{ role: 'backend', stacks_json: '["C#",".NET"]', origin: 'generated', status: 'ready' }])
  await card.getByRole('button', { name: 'View' }).click()
  await expect(panel(page, 'Back-End · C#, .NET PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  await expect(card.getByRole('button', { name: 'Regenerate' })).toBeEnabled()

  workspace.cli(['job', 'save', '--linkedin-id', '9401', '--title', 'Backend Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9401', '--description', 'C# and .NET APIs'])
  const id = workspace.query("SELECT id FROM jobs WHERE linkedin_job_id = '9401'")[0]!.id
  await workspace.visit(`/apply?jobId=${id}`, 'Application')
  await expect(page.getByRole('combobox', { name: /^Saved resume/ })).toContainText('Back-End · C#, .NET — 2 pages')
  await page.getByRole('button', { name: 'Use this resume' }).click()
  await expect(page.getByText('From saved resume Back-End · C#, .NET')).toBeVisible()
  await page.getByRole('button', { name: 'Approve this version', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fill application', exact: true })).toBeEnabled()
  expect(workspace.calls('tailor')).toHaveLength(1)
  const [run] = workspace.query("SELECT id FROM application_runs WHERE provider = 'saved-resume'")
  expect(workspace.query(`SELECT variant_id IS NOT NULL AS linked, approved_at IS NOT NULL AS approved FROM document_versions WHERE run_id = '${run!.id}'`)).toEqual([{ linked: 1, approved: 1 }])
  await expect(panel(page, 'Tailored PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
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
  const card = page.getByRole('article', { name: 'Synthetic imported resume' })
  await expect(card).toContainText('Other · Imported PDF')
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)
  await card.getByRole('button', { name: 'View' }).click()
  await expect(panel(page, 'Synthetic imported resume PDF').locator('.react-pdf__Page__textContent')).not.toBeEmpty()
  expect(workspace.query('SELECT origin, status, source_version FROM resume_variants')).toEqual([{ origin: 'imported', status: 'ready', source_version: null }])
})
