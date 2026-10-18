import { test, expect } from './fixtures'
import { panel } from './ui'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

test.use({ populated: true })

test('Settings: back up, reject a damaged copy, review and restore the workspace', async ({ workspace, page }) => {
  const destination = join(workspace.home, 'backup destination')
  mkdirSync(destination)
  await workspace.go('Settings')
  await page.getByRole('tab', { name: 'Backup', exact: true }).click()
  const create = panel(page, 'Back up workspace')
  await workspace.picker([destination])
  await create.getByRole('button', { name: 'Browse' }).click()
  await expect(create.getByLabel('Backup destination')).toHaveValue(destination)
  await create.getByRole('button', { name: 'Create backup' }).click()
  await expect(create.getByRole('status')).toContainText('Backup created at')
  const [name] = readdirSync(destination)
  const backup = join(destination, name!)

  const db = new DatabaseSync(join(workspace.home, 'work-tracker.db'))
  try { db.exec("UPDATE jobs SET title = 'Changed after backup' WHERE id = 1") } finally { db.close() }

  const restore = panel(page, 'Restore workspace')
  await restore.getByLabel('Backup folder').fill(join(workspace.home, 'missing'))
  await restore.getByRole('button', { name: 'Check backup' }).click()
  await expect(restore.getByRole('alert')).toContainText('does not exist')
  await restore.getByLabel('Backup folder').fill(backup)
  await restore.getByRole('button', { name: 'Check backup' }).click()
  const summary = restore.getByLabel('Backup summary')
  await expect(summary).toContainText(/Schemav\d+/)
  await expect(summary).toContainText('Jobs17')
  await expect(restore.getByRole('status')).toHaveCount(0)
  expect(workspace.query('SELECT title FROM jobs WHERE id = 1')).toEqual([{ title: 'Changed after backup' }])

  // A copy changed after review is refused instead of being applied.
  const manifest = join(backup, 'manifest.json')
  const original = readFileSync(manifest, 'utf8')
  writeFileSync(manifest, original.replace('"appVersion"', '"appVersion" ').replace(/\n$/, ''))
  await restore.getByRole('button', { name: 'Restore this backup' }).click()
  await expect(restore.getByRole('alert')).toContainText('changed after it was reviewed')
  expect(workspace.query('SELECT title FROM jobs WHERE id = 1')).toEqual([{ title: 'Changed after backup' }])

  writeFileSync(manifest, original)
  await restore.getByRole('button', { name: 'Check backup' }).click()
  await restore.getByRole('button', { name: 'Restore this backup' }).click()
  await expect(restore.getByRole('status')).toContainText('The previous workspace was kept at')
  expect(workspace.query('SELECT title FROM jobs WHERE id = 1')).toEqual([{ title: 'Engineer 01' }])
  expect(readdirSync(join(workspace.home, 'backups')).some(entry => entry.startsWith('pre-restore-'))).toBe(true)
  await workspace.go('Jobs')
  await expect(page.getByText('Engineer 01').first()).toBeVisible()
})
