import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { test, expect, type Workspace } from './fixtures'

/** Submitted applications on the board whose whole history is `days` old. */
function seedSent(workspace: Workspace, rows: { company: string; days: number; stage?: string }[]) {
  const db = new DatabaseSync(join(workspace.home, 'work-tracker.db'))
  try {
    for (const { company, days, stage = 'applied' } of rows) {
      const at = new Date(Date.now() - days * 86400_000).toISOString()
      const { id } = db.prepare(`INSERT INTO applications (status, attempt, origin, company_name, role_title, external_url, submission_status,
          submitted_at, applied_at, tracking_status, current_stage_id, stack_json, created_at, updated_at)
        VALUES ('submitted', 1, 'manual', ?, 'Engineer', 'https://example.com/quiet', 'submitted', ?, ?, 'active',
          (SELECT id FROM application_stages WHERE key = ?), '[]', ?, ?) RETURNING id`).get(company, at, at, stage, at, at) as { id: number }
      db.prepare(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
        SELECT ?, 'created', id, name, category, ? FROM application_stages WHERE key = 'applied'`).run(id, at)
    }
  } finally { db.close() }
}

test('Quiet sweep: banner, threshold, confirmation and closing as No response', async ({ workspace, page }) => {
  seedSent(workspace, [
    { company: 'Quiet One', days: 90 },
    { company: 'Quiet Two', days: 70 },
    { company: 'Fresh Company', days: 10 },
    { company: 'Offer Company', days: 120, stage: 'offer' },
  ])
  await workspace.go('Applications')
  await workspace.go('Dashboard')
  await page.getByRole('link', { name: '2 applications quiet for 60+ days' }).click()
  await workspace.ready('Applications')
  const banner = page.getByText('2 applications quiet for 60+ days')
  await expect(banner).toBeVisible()
  await page.getByRole('tab', { name: 'Board', exact: true }).click()
  await expect(banner).toBeVisible()

  await page.getByRole('button', { name: 'Review quiet applications' }).click()
  const dialog = page.getByRole('dialog', { name: 'Quiet applications' })
  const table = dialog.getByRole('table', { name: 'Quiet applications' })
  await expect(table.getByRole('row')).toHaveCount(3)
  await expect(table).toContainText('Quiet One')
  await expect(table).not.toContainText('Fresh Company')
  await expect(table).not.toContainText('Offer Company')
  await dialog.getByLabel('Days without activity').fill('3')
  await expect(dialog.getByRole('alert')).toContainText('at least 7 days')
  await dialog.getByLabel('Days without activity').fill('80')
  await expect(table.getByRole('row')).toHaveCount(2)
  await dialog.getByLabel('Days without activity').fill('60')
  await expect(table.getByRole('row')).toHaveCount(3)

  await dialog.getByRole('checkbox', { name: 'Select all' }).check()
  await dialog.getByRole('button', { name: 'Close selected as No response' }).click()
  await expect(dialog.getByRole('group', { name: 'Confirm closing' })).toContainText('Close 2 applications as No response?')
  await dialog.getByRole('button', { name: 'Close 2 applications' }).click()
  await expect(dialog.getByRole('status')).toContainText('Closed 2 applications as No response.')
  await expect(dialog.getByText('No submitted application is quiet for this long.')).toBeVisible()
  expect(workspace.query("SELECT company_name, archive_reason FROM applications WHERE tracking_status = 'archived' ORDER BY company_name")).toEqual([
    { company_name: 'Quiet One', archive_reason: 'no_response' },
    { company_name: 'Quiet Two', archive_reason: 'no_response' },
  ])
  expect(workspace.query("SELECT note FROM application_events WHERE event_type = 'archived' ORDER BY id")).toEqual([
    { note: 'Closed by quiet sweep (90 days without activity)' },
    { note: 'Closed by quiet sweep (70 days without activity)' },
  ])
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(/quiet for 60\+ days/)).toHaveCount(0)
  await workspace.go('Dashboard')
  await expect(page.getByRole('link', { name: /quiet for 60\+ days/ })).toHaveCount(0)
})
