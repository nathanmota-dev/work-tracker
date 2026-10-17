import { test, expect } from './fixtures'
import { choose, panel } from './ui'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

async function selectJob(workspace: import('./fixtures').Workspace) {
  workspace.cli(['job', 'save', '--linkedin-id', '9001', '--title', 'React Engineer', '--company', 'Example Company', '--link', 'https://example.com/apply'])
  await workspace.go('Apply')
  await choose(workspace.page, 'Saved job', 'Example Company · React Engineer')
  await expect(workspace.page.getByRole('button', { name: 'Generate resume', exact: true })).toBeEnabled()
}
async function generate(workspace: import('./fixtures').Workspace) {
  await workspace.page.getByRole('button', { name: /^(Generate resume|Regenerate)$/ }).click()
  await expect(workspace.page.getByRole('button', { name: 'Fill application', exact: true })).toBeEnabled({ timeout: 90_000 })
  await expect(panel(workspace.page, 'Tailored PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
}

test('Apply: real PDFs, generation/regeneration/history, filling, submission and persisted application', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  await selectJob(workspace)
  await page.getByText('Job description', { exact: true }).click()
  await page.getByLabel('Job description', { exact: true }).fill('React, TypeScript and testing')
  await expect(page.getByRole('button', { name: 'Generate resume', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Save description' }).click()
  await page.getByLabel('Additional context').fill('Focus on testing')
  await generate(workspace)
  // Classic scrollbars consume layout width. At this viewport, zoom crosses
  // the vertical overflow threshold and must not trigger a resize/render loop.
  await workspace.resize(1200)
  await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; }' })
  const first = workspace.query('SELECT id FROM application_runs')[0]!.id
  const id = workspace.query('SELECT id FROM applications')[0]!.id
  await expect(panel(page, 'Base PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  await panel(page, 'Base PDF').getByRole('button', { name: 'Next', exact: true }).click()
  await expect(panel(page, 'Base PDF').locator('.react-pdf__Page__textContent')).toContainText('Second page.')
  await panel(page, 'Base PDF').getByRole('button', { name: 'Previous', exact: true }).click()
  const canvas = panel(page, 'Base PDF').locator('canvas')
  // PDF.js can hide or replace the canvas while changing page or scale, while
  // ResizeObserver may trigger another render. Wait for two identical visible
  // measurements so controls are not exercised during that transient state.
  const stableCanvasWidth = async () => {
    let previous = 0
    let stable = 0
    let result = 0
    await expect.poll(async () => {
      const width = (await canvas.boundingBox())?.width ?? 0
      stable = width > 0 && width === previous ? stable + 1 : 0
      previous = width
      if (stable >= 1) result = width
      return stable
    }).toBeGreaterThan(0)
    return result
  }
  await expect(panel(page, 'Base PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  const baseWidth = await stableCanvasWidth()
  const viewport = panel(page, 'Base PDF').locator('.overflow-auto')
  const viewportWidth = await viewport.evaluate(el => el.clientWidth)
  await page.getByRole('button', { name: 'Zoom in Base PDF' }).click()
  expect(await stableCanvasWidth()).toBeGreaterThan(baseWidth)
  expect(await viewport.evaluate(el => el.clientWidth)).toBe(viewportWidth)
  await page.getByRole('button', { name: 'Zoom out Base PDF' }).click()
  expect(await stableCanvasWidth()).toBe(baseWidth)
  await page.getByRole('button', { name: 'Zoom in Base PDF' }).click()
  expect(await stableCanvasWidth()).toBeGreaterThan(baseWidth)
  await panel(page, 'Base PDF').getByRole('button', { name: 'Fit width', exact: true }).click()
  expect(await stableCanvasWidth()).toBe(baseWidth)
  await page.getByRole('tab', { name: 'Report', exact: true }).click()
  await expect(page.getByText('Emphasized React and TypeScript experience.', { exact: true })).toBeVisible()
  const output = join(workspace.home, 'tailored-export.pdf')
  await workspace.picker(undefined, output)
  await page.getByRole('button', { name: 'Download Tailored PDF' }).click()
  await expect.poll(() => existsSync(output)).toBe(true)
  expect(readFileSync(output).subarray(0, 5).toString()).toBe('%PDF-')
  await generate(workspace)
  expect(workspace.query('SELECT id FROM applications')).toEqual([{ id }])
  const runs = workspace.query('SELECT id FROM application_runs ORDER BY rowid')
  expect(runs).toHaveLength(2)
  // Select the previous execution through the actual Radix history control.
  await page.getByRole('combobox', { name: /^Execution history/ }).click()
  await page.getByRole('option').last().click()
  await expect(page).toHaveURL(new RegExp(`runId=${first}`))
  await page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(page.getByRole('button', { name: 'I submitted in the browser' })).toBeVisible({ timeout: 30_000 })
  const fill = workspace.calls('fill').at(-1)!
  expect(fill.applicationId).toBe(id)
  expect(fill.pdfPath).toContain(String(first))
  expect(workspace.query('SELECT status FROM applications')[0]?.status).toBe('filled')
  // A failed confirmation shows no success and keeps the action available for a retry.
  await workspace.fault('application-preparation/submitted')
  await page.getByRole('button', { name: 'I submitted in the browser' }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic transport failure')
  await expect(page.getByText(/Submission confirmed/)).toHaveCount(0)
  expect(workspace.query('SELECT status FROM applications')[0]?.status).toBe('filled')
  await page.getByRole('button', { name: 'I submitted in the browser' }).click()
  await expect(page.getByText(/Submission confirmed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled()
  expect(workspace.query('SELECT status FROM applications')[0]?.status).toBe('submitted')
  // The same application enters the board in its initial stage with one history event.
  expect(workspace.query("SELECT a.id, s.key, a.tracking_status FROM applications a JOIN application_stages s ON s.id = a.current_stage_id")).toEqual([{ id, key: 'applied', tracking_status: 'active' }])
  expect(workspace.query('SELECT event_type FROM application_events')).toEqual([{ event_type: 'created' }])
  await page.getByRole('link', { name: 'Open the application board' }).click()
  await expect(page.getByRole('region', { name: 'Applied applications' }).getByRole('button', { name: 'View Example Company application' })).toBeVisible()
  expect(readFileSync(join(workspace.project, 'resume.tex'), 'utf8')).toBe(readFileSync('e2e/fixtures/resume.tex', 'utf8'))
  await workspace.go('Automatic applications')
  await expect(page.getByRole('cell', { name: 'submitted', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View React Engineer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Prepare application' }).click()
  await expect(page).toHaveURL(new RegExp(`jobId=1&applicationId=${id}`))
  await workspace.go('Activity')
  await expect(page.getByRole('cell', { name: 'Prepared Example Company React Engineer', exact: true }).first()).toBeVisible()
  await workspace.restart()
  await workspace.go('Automatic applications')
  await expect(workspace.page.getByRole('cell', { name: 'submitted', exact: true })).toBeVisible()
})

test('Apply: failed regeneration preserves PDF; cancel and sign-in retry keep application identity', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  await selectJob(workspace)
  await generate(workspace)
  const saved = workspace.query('SELECT id, resume_path FROM applications')[0]
  workspace.setScenario({ agent: 'invalid-latex' })
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await expect(page.getByText('Execution needs attention', { exact: true })).toBeVisible({ timeout: 90_000 })
  expect(workspace.query('SELECT id, resume_path FROM applications')[0]).toEqual(saved)
  await expect(panel(page, 'Tailored PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  workspace.setScenario({ agent: 'hold' })
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => workspace.query('SELECT status FROM application_runs ORDER BY rowid DESC LIMIT 1')[0]?.status).toBe('cancelled')
  workspace.setScenario({ agent: 'login' })
  await page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry after sign-in', exact: true })).toBeEnabled()
  workspace.setScenario({})
  await page.getByRole('button', { name: 'Retry after sign-in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'I submitted in the browser' })).toBeVisible()
  expect(workspace.query('SELECT id FROM applications')).toEqual([{ id: saved!.id }])
})
