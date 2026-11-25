import { test, expect } from './fixtures'

test('Interview prep reuses the cached company research until Refresh forces a new one', async ({ workspace, page }) => {
  const at = new Date().toISOString()
  workspace.query(`INSERT INTO applications (status, attempt, origin, company_name, role_title, tracking_status, current_stage_id, stack_json, created_at, updated_at)
    VALUES ('submitted', 1, 'manual', 'Acme Corp', 'Backend Engineer', 'active', (SELECT id FROM application_stages WHERE key = 'applied'), '[]', '${at}', '${at}') RETURNING id`)
  await workspace.go('Interview prep')
  const build = page.getByRole('button', { name: 'Build pack', exact: true })
  const form = page.getByRole('dialog', { name: 'Build a preparation pack' })
  const packs = () => workspace.query('SELECT body_md FROM interview_preps ORDER BY id').map(row => String(row.body_md).trim())
  const openForm = async () => {
    await expect(build).toBeEnabled()
    await build.click()
    await expect(form).toBeVisible()
  }
  // Running closes the form; the pack appears as a card once the agent saves it.
  const runOnce = async (count: number) => {
    if (!await form.isVisible()) await openForm()
    await form.getByRole('button', { name: 'Run agent' }).click()
    await expect(form).toHaveCount(0)
    await expect.poll(packs).toHaveLength(count)
    await expect(page.getByRole('article', { name: 'Backend Engineer' })).toHaveCount(count)
    await expect(build).toBeEnabled()
  }

  await openForm()
  await expect(form.getByText(/Company research cached/)).toHaveCount(0)
  await runOnce(1)
  expect(workspace.calls('research')).toHaveLength(1)
  expect(workspace.query('SELECT company_key, company_name FROM company_research')).toEqual([{ company_key: 'acme-corp', company_name: 'Acme Corp' }])
  await openForm()
  await expect(form.getByText('Company research cached today')).toBeVisible()

  await runOnce(2)
  expect(workspace.calls('research')).toHaveLength(1)
  expect(packs()[1]).toBe('# Acme Corp\n\nReused cached research.')

  await openForm()
  await form.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(form.getByText(/Company research cached/)).toHaveCount(0)
  expect(workspace.query('SELECT COUNT(*) AS n FROM company_research')).toEqual([{ n: 0 }])

  await runOnce(3)
  expect(workspace.calls('research')).toHaveLength(2)
  expect(packs()[2]).toBe('# Acme Corp\n\nFresh research.')
  await openForm()
  await expect(form.getByText('Company research cached today')).toBeVisible()
  await page.keyboard.press('Escape')

  // The newest pack opens in the side panel with its Markdown.
  await page.getByRole('article', { name: 'Backend Engineer' }).first().getByRole('button', { name: 'Open pack' }).click()
  await expect(page.getByRole('dialog').getByText('Fresh research.')).toBeVisible()
})
