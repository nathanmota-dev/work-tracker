import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { test, expect, type Workspace } from './fixtures'
import { choose } from './ui'

/** A submitted application on the board whose whole history is `days` old; returns its ID. */
function seedSent(workspace: Workspace, company: string, days: number, sentFollowUps = 0) {
  const db = new DatabaseSync(join(workspace.home, 'work-tracker.db'))
  try {
    const at = new Date(Date.now() - days * 86400_000).toISOString()
    const { id } = db.prepare(`INSERT INTO applications (status, attempt, origin, company_name, role_title, external_url, submission_status,
        submitted_at, applied_at, tracking_status, current_stage_id, stack_json, created_at, updated_at)
      VALUES ('submitted', 1, 'manual', ?, 'Engineer', 'https://example.com/followup', 'submitted', ?, ?, 'active',
        (SELECT id FROM application_stages WHERE key = 'applied'), '[]', ?, ?) RETURNING id`).get(company, at, at, at, at) as { id: number }
    db.prepare(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
      SELECT ?, 'created', id, name, category, ? FROM application_stages WHERE key = 'applied'`).run(id, at)
    for (let i = 0; i < sentFollowUps; i++)
      db.prepare(`INSERT INTO followup_drafts (application_id, kind, channel, body_md, status, created_at, sent_at)
        VALUES (?, 'follow_up', 'email', 'Earlier follow-up', 'sent', ?, ?)`).run(id, at, at)
    return id
  } finally { db.close() }
}

test('Follow-ups: due banner, synthetic draft, mark as sent, cap of two and thank-you after an interview move', async ({ workspace, page }) => {
  const quiet = seedSent(workspace, 'Quiet Company', 12)
  seedSent(workspace, 'Fresh Company', 3)
  const capped = seedSent(workspace, 'Capped Company', 40, 2)
  await workspace.go('Applications')
  await expect(page.getByText('1 follow-up due', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review follow-ups due' }).click()
  const due = page.getByRole('dialog', { name: 'Follow-ups due' })
  await expect(due).toContainText('Quiet Company')
  await expect(due).toContainText('quiet for 12 days · 0 of 2 follow-ups sent')
  await expect(due).not.toContainText('Fresh Company')
  await expect(due).not.toContainText('Capped Company')

  // Drafting opens the agent panel over the page; the synthetic agent stores the draft.
  await due.getByRole('button', { name: 'Draft follow-up for Quiet Company — Engineer' }).click()
  const panel = page.getByRole('dialog', { name: 'Agent task' })
  await expect(panel.getByRole('heading', { name: 'Draft a follow-up' })).toBeVisible()
  await panel.getByRole('button', { name: 'Run agent' }).click()
  await expect(panel.getByRole('log')).toContainText('Synthetic workflow completed.')
  expect(workspace.calls('prompt').at(-1)?.text).toContain(`work-tracker-followup skill to draft a follow-up (kind follow_up) for application #${quiet}`)
  expect(workspace.query('SELECT kind, channel, subject, status FROM followup_drafts WHERE application_id = ' + quiet)).toEqual([
    { kind: 'follow_up', channel: 'email', subject: 'Following up: Engineer', status: 'draft' },
  ])
  await panel.getByRole('button', { name: 'Close', exact: true }).click()

  // The draft waits in the application details until the user sends it and marks it.
  await workspace.board()
  await page.getByRole('button', { name: 'View Quiet Company application' }).click()
  const details = page.getByRole('dialog', { name: 'Quiet Company' })
  const section = details.getByRole('region', { name: 'Follow-ups' })
  await expect(section.getByRole('listitem', { name: 'Follow-up by Email' })).toContainText('Subject: Following up: Engineer')
  await expect(section).toContainText('0 of 2 follow-ups sent')
  await section.getByRole('button', { name: 'Mark as sent' }).click()
  await expect(section.getByRole('status')).toContainText('Marked as sent')
  await expect(section).toContainText('1 of 2 follow-ups sent')
  expect(workspace.query(`SELECT status, sent_at IS NOT NULL AS dated FROM followup_drafts WHERE application_id = ${quiet}`)).toEqual([{ status: 'sent', dated: 1 }])
  await expect(page.getByText(/follow-ups? due/)).toHaveCount(0)

  // Moving to an interview stage offers a thank-you note; drafting it keeps the stage.
  await choose(page, 'Current stage', 'Technical interview')
  await expect.poll(() => workspace.query(`SELECT event_type FROM application_events WHERE application_id = ${quiet} ORDER BY id DESC LIMIT 1`)[0]?.event_type).toBe('moved')
  await expect(page.getByText('1 thank-you note due', { exact: true })).toBeVisible()
  await section.getByRole('button', { name: 'Draft thank-you' }).click()
  await panel.getByRole('button', { name: 'Run agent' }).click()
  await expect.poll(() => workspace.query(`SELECT kind, stage_event_id IS NOT NULL AS linked FROM followup_drafts WHERE kind = 'thank_you'`)).toEqual([{ kind: 'thank_you', linked: 1 }])
  await expect(panel.getByRole('log')).toContainText('Synthetic workflow completed.')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  expect(workspace.query(`SELECT s.key FROM applications a JOIN application_stages s ON s.id = a.current_stage_id WHERE a.id = ${quiet}`)).toEqual([{ key: 'technical' }])
  await expect(page.getByText(/thank-you notes? due/)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(details).toHaveCount(0)

  // After two sent follow-ups the third is not offered, and the CLI refuses it.
  await page.getByRole('button', { name: 'View Capped Company application' }).click()
  const cappedSection = page.getByRole('dialog', { name: 'Capped Company' }).getByRole('region', { name: 'Follow-ups' })
  await expect(cappedSection.getByRole('button', { name: 'Draft follow-up' })).toBeDisabled()
  await expect(cappedSection).toContainText('2 follow-ups already sent')
  expect(() => workspace.cli(['followup', 'save', '--application-id', String(capped), '--kind', 'follow_up', '--channel', 'portal', '--file', join(workspace.home, 'artifacts', 'followups', `${quiet}-follow_up.md`)]))
    .toThrow(/2 follow-ups were already sent/)
})
