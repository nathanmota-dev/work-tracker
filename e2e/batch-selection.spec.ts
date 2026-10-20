import { test, expect } from './fixtures'
import { choose } from './ui'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

test('Jobs: select across pages, review five jobs and create one batch with shared and overridden context', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  for (let i = 1; i <= 17; i++) workspace.cli(['job', 'save', '--linkedin-id', String(9800 + i), '--title', `Bulk role ${String(i).padStart(2, '0')}`, '--company', `Synthetic ${i}`, '--link', `https://example.test/jobs/${i}`])
  // Distinct timestamps exercise newest-first ordering even on fast local runs.
  const database = new DatabaseSync(join(workspace.home, 'work-tracker.db'))
  try { database.exec("UPDATE jobs SET scouted_at = datetime('2026-01-01', '+' || id || ' seconds')") }
  finally { database.close() }
  await workspace.go('Jobs')
  await page.getByRole('button', { name: 'Select page (15)', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^15 selected$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^15 selected$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search Opportunities', exact: true }).fill('Bulk role 0')
  await page.getByRole('button', { name: 'Select all filtered results (9)', exact: true }).click()
  for (let i = 6; i <= 9; i++) await page.getByRole('checkbox', { name: `Select Bulk role 0${i}`, exact: true }).uncheck()
  await expect(page.getByRole('status').filter({ hasText: /^5 selected$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Prepare selected', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('5 selected · 5 eligible · 0 excluded')
  await choose(page, 'Batch agent', 'opencode')
  await dialog.getByRole('textbox', { name: 'Shared context', exact: true }).fill('Common synthetic context')
  await dialog.getByRole('textbox', { name: 'Context for Bulk role 02', exact: true }).fill('Only this synthetic context')
  await dialog.getByRole('button', { name: 'Create batch (5)', exact: true }).dblclick()
  await expect(page.getByRole('status').filter({ hasText: 'Batch created with 5 jobs.' })).toBeVisible()
  expect(workspace.query('SELECT COUNT(*) AS n FROM preparation_batches')).toEqual([{ n: 1 }])
  expect(workspace.query('SELECT COUNT(*) AS n FROM preparation_batch_items')).toEqual([{ n: 5 }])
  expect(workspace.query("SELECT extra FROM preparation_batches")).toEqual([{ extra: 'Common synthetic context' }])
  expect(workspace.query(`SELECT j.linkedin_job_id, i.options_json FROM preparation_batch_items i
    JOIN jobs j ON j.id = i.job_id ORDER BY j.linkedin_job_id`)).toEqual(Array.from({ length: 5 }, (_, i) => ({
    linkedin_job_id: String(9801 + i), options_json: JSON.stringify(i === 1 ? { extra: 'Only this synthetic context' } : {}),
  })))
  await page.getByRole('link', { name: 'Open preparation queue' }).click()
  await expect(page.getByRole('heading', { name: 'Preparation queue', exact: true })).toBeVisible()
  await expect.poll(() => workspace.query("SELECT COUNT(*) AS n FROM preparation_batch_items WHERE phase = 'ready_for_review'")[0]!.n, { timeout: 120_000 }).toBe(5)
  expect(workspace.query(`SELECT j.linkedin_job_id, json_extract(r.options_json, '$.extra') AS context FROM application_runs r
    JOIN jobs j ON j.id = r.job_id ORDER BY j.linkedin_job_id`)).toEqual(Array.from({ length: 5 }, (_, i) => ({
    linkedin_job_id: String(9801 + i), context: i === 1 ? 'Only this synthetic context' : 'Common synthetic context',
  })))
  expect(workspace.query("SELECT COUNT(*) AS n FROM applications WHERE submission_status = 'submitted'")).toEqual([{ n: 0 }])
  expect(workspace.calls('fill')).toHaveLength(0)
})
