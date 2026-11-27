import { test, expect } from './fixtures'
import { closeDialog, jobMenu, openJob, openStep, panel, resumeCard } from './ui'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const step = (workspace: import('./fixtures').Workspace, name: string) => workspace.page.getByRole('navigation', { name: 'Application progress' }).getByRole('listitem', { name })
/** Shortlist → Apply: the application detail opens without the sidebar or a job selector. */
async function selectJob(workspace: import('./fixtures').Workspace) {
  const { page } = workspace
  workspace.cli(['job', 'save', '--linkedin-id', '9001', '--title', 'React Engineer', '--company', 'Example Company', '--link', 'https://example.com/apply'])
  await workspace.go('Jobs')
  await jobMenu(page, 'React Engineer', 'Move to shortlist')
  await page.getByRole('tab', { name: 'Shortlist (1)' }).click()
  await openJob(page, 'React Engineer')
  await page.getByRole('dialog', { name: 'React Engineer' }).getByRole('button', { name: 'Apply', exact: true }).click()
  await workspace.ready('Application')
  await expect(page.getByRole('navigation', { name: 'Caminho da página' }).locator('[aria-current="page"]')).toHaveText('Example Company · React Engineer')
  await expect(page.getByRole('combobox', { name: /^Saved job/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate resume', exact: true })).toBeEnabled()
  await expect(step(workspace, '2. Resume: Current step')).toHaveAttribute('aria-current', 'step')
}
async function generate(workspace: import('./fixtures').Workspace) {
  const { page } = workspace
  await openStep(page, 'Resume')
  await page.getByRole('button', { name: /^(Generate resume|Regenerate)$/ }).click()
  await expect(page.getByRole('button', { name: 'Approve this version', exact: true })).toBeEnabled({ timeout: 90_000 })
  // A generated resume is ready to fill; approving it is optional.
  await expect(step(workspace, '3. Fill portal: Current step')).toBeVisible()
  await expect(page.getByLabel('Document text comparison').locator('ins')).toContainText('Tailored resume.')
  await expect(page.getByLabel('Document text comparison').locator('del')).toContainText('Base resume.')
  await expect(panel(page, 'Tailored resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  await page.getByRole('button', { name: 'Approve this version', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Version approved', exact: true })).toBeDisabled()
  await openStep(page, 'Fill portal')
  await expect(page.getByRole('button', { name: 'Fill application', exact: true })).toBeEnabled()
}

test('Apply: real PDFs, generation/regeneration/history, filling, submission and persisted application', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  await selectJob(workspace)
  await openStep(page, 'Job description')
  await page.getByLabel('Job description', { exact: true }).fill('React, TypeScript and testing')
  await expect(step(workspace, '1. Job description: Blocked')).toContainText('Save your description changes before generating.')
  await openStep(page, 'Resume')
  await expect(page.getByRole('button', { name: 'Generate resume', exact: true })).toBeDisabled()
  await openStep(page, 'Job description')
  await page.getByRole('button', { name: 'Save description' }).click()
  await openStep(page, 'Resume')
  await page.getByLabel('Additional context').fill('Focus on testing')
  await generate(workspace)
  // The base's own layout findings stay on the base; a clean tailoring adds none.
  await openStep(page, 'Resume')
  await expect(panel(page, 'Tailored resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  await expect(panel(page, 'Tailored resume PDF').getByRole('listitem')).toHaveCount(0)
  await resumeCard(page, 'Base resume').click()
  await expect(panel(page, 'Base resume PDF')).toContainText('Page 1 ends')
  // Classic scrollbars consume layout width. At this viewport, zoom crosses
  // the vertical overflow threshold and must not trigger a resize/render loop.
  await workspace.resize(1200)
  await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; }' })
  const first = workspace.query('SELECT id FROM application_runs')[0]!.id
  const id = workspace.query('SELECT id FROM applications')[0]!.id
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  await panel(page, 'Base resume PDF').getByRole('button', { name: 'Next', exact: true }).click()
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Second page.')
  await panel(page, 'Base resume PDF').getByRole('button', { name: 'Previous', exact: true }).click()
  const canvas = panel(page, 'Base resume PDF').locator('canvas')
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
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  const baseWidth = await stableCanvasWidth()
  const viewport = panel(page, 'Base resume PDF').locator('.overflow-auto')
  const viewportWidth = await viewport.evaluate(el => el.clientWidth)
  await page.getByRole('button', { name: 'Zoom in Base resume PDF' }).click()
  expect(await stableCanvasWidth()).toBeGreaterThan(baseWidth)
  expect(await viewport.evaluate(el => el.clientWidth)).toBe(viewportWidth)
  await page.getByRole('button', { name: 'Zoom out Base resume PDF' }).click()
  expect(await stableCanvasWidth()).toBe(baseWidth)
  await page.getByRole('button', { name: 'Zoom in Base resume PDF' }).click()
  expect(await stableCanvasWidth()).toBeGreaterThan(baseWidth)
  await panel(page, 'Base resume PDF').getByRole('button', { name: 'Fit width', exact: true }).click()
  expect(await stableCanvasWidth()).toBe(baseWidth)
  await page.locator('summary', { hasText: /^Tailoring report$/ }).click()
  await expect(page.getByText('Emphasized React and TypeScript experience.', { exact: true })).toBeVisible()
  await resumeCard(page, 'Tailored resume', true).click()
  const output = join(workspace.home, 'tailored-export.pdf')
  await workspace.picker(undefined, output)
  await page.getByRole('button', { name: 'Download Tailored resume PDF' }).click()
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
  await expect(step(workspace, '4. Confirm submission: Current step')).toBeVisible({ timeout: 30_000 })
  await openStep(page, 'Confirm submission')
  await expect(page.getByRole('button', { name: 'I submitted in the browser' })).toBeVisible()
  const fill = workspace.calls('fill').at(-1)!
  expect(fill.applicationId).toBe(id)
  const approved = workspace.query(`SELECT id, pdf_hash, approved_at FROM document_versions WHERE run_id = '${first}'`)[0]!
  expect(approved.approved_at).toBeTruthy()
  const usage = workspace.query('SELECT version_id, pdf_hash FROM application_documents')[0]!
  expect(usage).toMatchObject({ version_id: approved.id, pdf_hash: approved.pdf_hash })
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
  // The fill checklist reflects the confirmation without repeating the submission notice.
  await openStep(page, 'Fill portal')
  await expect(page.getByText(/^Marked as submitted on /)).toBeVisible()
  await openStep(page, 'Resume')
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled()
  expect(workspace.query('SELECT status FROM applications')[0]?.status).toBe('submitted')
  expect(workspace.query('SELECT version_id, submitted_at FROM application_documents')[0]).toMatchObject({ version_id: approved.id, submitted_at: expect.any(String) })
  // The same application enters the board in its initial stage with one history event.
  expect(workspace.query("SELECT a.id, s.key, a.tracking_status FROM applications a JOIN application_stages s ON s.id = a.current_stage_id")).toEqual([{ id, key: 'applied', tracking_status: 'active' }])
  expect(workspace.query('SELECT event_type FROM application_events')).toEqual([{ event_type: 'created' }])
  await expect(step(workspace, '4. Confirm submission: Done')).toBeVisible()
  await openStep(page, 'Confirm submission')
  await page.getByRole('link', { name: 'View it on the board' }).click()
  await workspace.ready('Applications')
  await expect(page).toHaveURL(new RegExp(`view=board&highlight=${id}`))
  const card = page.getByRole('region', { name: 'Applied applications' }).locator('[data-slot="card"]').filter({ has: page.getByRole('button', { name: 'View Example Company application' }) })
  await expect(card).toHaveAttribute('data-highlighted', 'true')
  await expect(page.getByRole('region', { name: 'Filled applications' }).getByRole('group')).toHaveCount(0)
  expect(readFileSync(join(workspace.project, 'resume.tex'), 'utf8')).toBe(readFileSync('e2e/fixtures/resume.tex', 'utf8'))
  await page.getByRole('radio', { name: 'Cards', exact: true }).click()
  await expect(page).not.toHaveURL(/view=board/)
  const reactCard = page.getByRole('article', { name: 'React Engineer' })
  await expect(reactCard.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /^Applied, step 1 of \d+$/)
  // Lists, Jobs and the dashboard count the same confirmed submission once.
  await expect(page.getByRole('tab', { name: 'Tracking (1)' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Preparation (0)' })).toBeVisible()
  await expect(reactCard.getByText('Apply', { exact: true })).toBeVisible()
  await expect(reactCard.getByRole('link', { name: 'Open board' })).toBeVisible()
  await workspace.go('Jobs')
  // Jobs reopens with the role's details, which show the confirmed submission.
  await expect(page.getByRole('dialog', { name: 'React Engineer' })).toContainText('Submitted')
  await closeDialog(page)
  await workspace.go('Dashboard')
  await expect(page.getByRole('link', { name: '1 submitted', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '0 drafts', exact: true })).toBeVisible()
  await workspace.go('Applications')
  await page.getByRole('button', { name: 'View details of React Engineer' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Prepare application' }).click()
  await expect(page).toHaveURL(new RegExp(`jobId=1&applicationId=${id}`))
  await workspace.visit('/launch?tab=history', 'Agent')
  await expect(page.getByRole('cell', { name: 'Prepared Example Company React Engineer', exact: true }).first()).toBeVisible()
  await workspace.restart()
  await workspace.go('Applications')
  await expect(workspace.page.getByRole('article', { name: 'React Engineer' }).getByRole('progressbar')).toHaveAttribute('aria-valuetext', /^Applied, step 1 of \d+$/)
})

test('Apply: the review lists layout problems the tailoring introduced, not the base ones', async ({ workspace, page }) => {
  test.setTimeout(120_000)
  await selectJob(workspace)
  workspace.setScenario({ agent: 'layout-hole' })
  await page.getByRole('button', { name: 'Generate resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve this version', exact: true })).toBeEnabled({ timeout: 90_000 })
  await expect(panel(page, 'Tailored resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Detail pushed down by a gap.')
  const warnings = panel(page, 'Tailored resume PDF').getByRole('listitem')
  await expect(warnings).toHaveCount(1)
  await expect(warnings).toHaveText(/^Page 1 has a \d+ pt gap at y=\d+/)
  await resumeCard(page, 'Base resume').click()
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  await expect(panel(page, 'Base resume PDF')).not.toContainText('pt gap')
})

test('Apply: failed regeneration preserves PDF; cancel and sign-in retry keep application identity', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  await selectJob(workspace)
  await generate(workspace)
  const saved = workspace.query('SELECT id, resume_path FROM applications')[0]
  workspace.setScenario({ agent: 'invalid-latex' })
  await openStep(page, 'Resume')
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await expect(page.getByText('Execution needs attention', { exact: true })).toBeVisible({ timeout: 90_000 })
  // The failed run keeps its tailored sources and offers to continue from compilation.
  await expect(page.getByRole('region', { name: 'Execution recovery' })).toContainText('Retrying continues from compilation with the tailored sources.')
  await expect(page.getByRole('button', { name: 'Continue from compilation', exact: true })).toBeEnabled()
  expect(workspace.query('SELECT id, resume_path FROM applications')[0]).toEqual(saved)
  await expect(panel(page, 'Tailored resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Tailored resume.')
  workspace.setScenario({ agent: 'hold' })
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => workspace.query('SELECT status FROM application_runs ORDER BY rowid DESC LIMIT 1')[0]?.status).toBe('cancelled')
  workspace.setScenario({ agent: 'login' })
  await openStep(page, 'Fill portal')
  await page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry after sign-in', exact: true })).toBeEnabled()
  workspace.setScenario({})
  await page.getByRole('button', { name: 'Retry after sign-in', exact: true }).click()
  await expect(step(workspace, '4. Confirm submission: Current step')).toBeVisible()
  expect(workspace.query('SELECT id FROM applications')).toEqual([{ id: saved!.id }])
  // The fill result reads as a checklist; correcting an answer fills again with the same approved PDF.
  const checklist = page.getByRole('list', { name: 'Fill checklist' })
  await expect(checklist).toContainText('Answer used: candidate@example.com')
  await expect(checklist).toContainText('No saved answer for this field.')
  await expect(checklist).toContainText('Demographic question.')
  const versions = workspace.query('SELECT id, pdf_hash, approved_at FROM document_versions ORDER BY rowid')
  const fills = workspace.calls('fill')
  await page.getByRole('link', { name: 'Add answer for Phone' }).click()
  await page.getByRole('textbox', { name: 'Answer', exact: true }).fill('+1 555 0100 200')
  await page.getByRole('button', { name: 'Save answer' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to the application checklist' }).click()
  await page.getByRole('button', { name: 'Fill again with the approved PDF' }).click()
  await expect(checklist).toContainText('Answer used: +1 555 0100 200', { timeout: 30_000 })
  expect(workspace.calls('fill')).toHaveLength(fills.length + 1)
  expect(workspace.calls('fill').at(-1)!.pdfPath).toBe(fills.at(-1)!.pdfPath)
  expect(workspace.query('SELECT id, pdf_hash, approved_at FROM document_versions ORDER BY rowid')).toEqual(versions)
  await page.getByRole('checkbox', { name: 'Completed Gender in the portal' }).check()
  await expect(page.getByText(/^Checklist complete\. The application is not submitted yet/)).toBeVisible()
  expect(workspace.query('SELECT fill_status, submission_status FROM applications')).toEqual([{ fill_status: 'filled', submission_status: 'not_submitted' }])
})
test('Apply: the base resume is used as it is, without tailoring, and filled by the selected agent', async ({ workspace }) => {
  const { page } = workspace
  await selectJob(workspace)
  await openStep(page, 'Resume')
  await resumeCard(page, 'Base resume').click()
  expect(workspace.calls('tailor')).toHaveLength(0)
  await openStep(page, 'Fill portal')
  await expect(panel(page, 'Fill portal')).toContainText('(your base resume as it is)')
  await page.getByRole('button', { name: 'Fill application', exact: true }).click()
  await expect(step(workspace, '4. Confirm submission: Current step')).toBeVisible({ timeout: 30_000 })
  await openStep(page, 'Resume')
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__textContent')).toContainText('Base resume.')
  await openStep(page, 'Confirm submission')
  await expect(page.getByRole('button', { name: 'I submitted in the browser' })).toBeVisible()
  expect(workspace.calls('fill')).toHaveLength(1)
  expect(workspace.query("SELECT provider FROM application_runs")).toEqual([{ provider: 'base-resume' }])
  // The base resume is already in Resumes, so filling with it saves nothing there.
  expect(workspace.query('SELECT COUNT(*) AS n FROM resume_variants')).toEqual([{ n: 0 }])
})
