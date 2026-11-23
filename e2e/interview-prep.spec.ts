import { test, expect } from './fixtures'

test('Interview prep reuses the cached company research until Refresh forces a new one', async ({ workspace, page }) => {
  const at = new Date().toISOString()
  workspace.query(`INSERT INTO applications (status, attempt, origin, company_name, role_title, tracking_status, current_stage_id, stack_json, created_at, updated_at)
    VALUES ('submitted', 1, 'manual', 'Acme Corp', 'Backend Engineer', 'active', (SELECT id FROM application_stages WHERE key = 'applied'), '[]', '${at}', '${at}') RETURNING id`)
  await workspace.go('Interview prep')
  const run = page.getByRole('button', { name: 'Run agent' })
  const packs = () => workspace.query('SELECT body_md FROM interview_preps ORDER BY id').map(row => String(row.body_md).trim())
  const runOnce = async (count: number) => {
    await expect(run).toBeEnabled()
    await run.click()
    await expect.poll(packs).toHaveLength(count)
    await expect(run).toBeEnabled()
  }

  await expect(page.getByText(/Company research cached/)).toHaveCount(0)
  await runOnce(1)
  expect(workspace.calls('research')).toHaveLength(1)
  expect(workspace.query('SELECT company_key, company_name FROM company_research')).toEqual([{ company_key: 'acme-corp', company_name: 'Acme Corp' }])
  await expect(page.getByText('Company research cached today')).toBeVisible()

  await runOnce(2)
  expect(workspace.calls('research')).toHaveLength(1)
  expect(packs()[1]).toBe('# Acme Corp\n\nReused cached research.')

  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText(/Company research cached/)).toHaveCount(0)
  expect(workspace.query('SELECT COUNT(*) AS n FROM company_research')).toEqual([{ n: 0 }])

  await runOnce(3)
  expect(workspace.calls('research')).toHaveLength(2)
  expect(packs()[2]).toBe('# Acme Corp\n\nFresh research.')
  await expect(page.getByText('Company research cached today')).toBeVisible()
})
