import { test, expect } from './fixtures'
import { appendFileSync, copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { panel } from './ui'

test('Profile sources: upload the LinkedIn export, import files placed by hand, decide a conflict and tailor with the consolidated profile', async ({ workspace, page }) => {
  test.setTimeout(180_000)
  const profileDir = join(workspace.repository, 'base', 'data')
  writeFileSync(workspace.dataFile, JSON.stringify({ skills: ['React', 'TypeScript'], work: [{ company: 'Northwind Labs', start: '2022-11', end: 'Present' }, { company: 'Fabrikam Studio', start: '2017', end: '2019-05' }] }))

  await workspace.go('Profile')
  await page.getByRole('tab', { name: 'Base resume' }).click()
  // Base resume names each source without its path and compiles the missing base PDF.
  const sources = page.getByRole('list', { name: 'Selected sources' })
  await expect(sources).toContainText('Profile folderdata')
  await expect(sources).not.toContainText(profileDir)
  await expect(page.getByPlaceholder('Folder with your LinkedIn export and resume PDFs')).toBeHidden()
  await expect(panel(page, 'Base resume PDF').locator('.react-pdf__Page__canvas')).toBeVisible({ timeout: 90_000 })

  // The export is uploaded through the interface into the profile folder and imported at once.
  await page.getByLabel('Choose profile files').setInputFiles('src/test/fixtures/profile/linkedin-export.pdf')
  await expect(page.getByRole('status').filter({ hasText: 'Added linkedin-export.pdf.' })).toBeVisible({ timeout: 30_000 })
  expect(existsSync(join(profileDir, 'linkedin-export.pdf'))).toBe(true)
  const files = page.getByRole('list', { name: 'Profile files' })
  await expect(files.getByRole('listitem').filter({ hasText: 'linkedin-export.pdf' })).toContainText('LinkedIn exportImported')
  await expect(files.getByRole('listitem').filter({ hasText: 'resume-data.json' })).toContainText('Data fileImported')

  // The upload filled the empty answers with the export's contact details, shown on Profile with their origin.
  await page.getByRole('tab', { name: 'LinkedIn', exact: true }).click()
  const personal = page.getByRole('region', { name: 'Personal information' })
  await expect(personal.getByText('alex@example.com', { exact: true })).toBeVisible()
  await expect(personal.getByText('From LinkedIn')).toHaveCount(5)
  await expect(page.getByRole('region', { name: 'Links' }).getByText('https://www.linkedin.com/in/alex-ex/', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Skills' })).toContainText('PostgreSQL')
  expect(workspace.query("SELECT key, source FROM answer_autofill ORDER BY key")).toEqual(
    ['email', 'first_name', 'full_name', 'last_name', 'linkedin_url', 'location'].map(key => ({ key, source: 'linkedin' })))
  await page.getByRole('tab', { name: 'Base resume' }).click()

  // A PDF placed in the folder by hand is imported without any action.
  const placed = join(profileDir, 'placed-by-hand.pdf')
  copyFileSync('src/test/fixtures/profile/linkedin-export.pdf', placed)
  appendFileSync(placed, '\n%placed\n')
  await expect(files.getByRole('listitem').filter({ hasText: 'placed-by-hand.pdf' })).toContainText('Imported', { timeout: 30_000 })
  await page.getByText('4 experiences · 1 education · 3 skills').click()
  await expect(page.getByRole('list', { name: 'Extracted experiences' })).toContainText('Junior Developer · Fabrikam Studio')

  // A different month is a conflict; the same year without a month is not.
  const conflicts = page.getByRole('region', { name: 'Profile conflicts' })
  await expect(conflicts).toContainText('0 of 1 conflicts decided')
  await conflicts.getByRole('button', { name: 'LinkedIn: 2022-12' }).click()
  await expect(conflicts).toContainText('1 of 1 conflicts decided')
  await expect(conflicts.getByRole('button', { name: 'LinkedIn: 2022-12' })).toHaveAttribute('aria-pressed', 'true')
  expect(workspace.query('SELECT field, chosen_source, chosen_value FROM profile_choices')).toEqual([{ field: 'work.start', chosen_source: 'linkedin', chosen_value: '2022-12' }])

  workspace.cli(['job', 'save', '--linkedin-id', '9301', '--title', 'TypeScript Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9301', '--description', 'TypeScript and React'])
  const id = workspace.query("SELECT id FROM jobs WHERE linkedin_job_id = '9301'")[0]!.id
  await page.evaluate(jobId => { window.location.hash = `/apply?jobId=${jobId}` }, id)
  await workspace.ready('Application')
  await expect(page.getByText(/undecided conflict/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Generate resume', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve this version', exact: true })).toBeEnabled({ timeout: 90_000 })
  const profile = workspace.calls('tailor').at(-1)!.profile as { skills: string[]; profileSources: { linkedin: { experience: { company: string }[] }; resolved: { value: string }[] } }
  expect(profile.skills).toEqual(['React', 'TypeScript'])
  expect(profile.profileSources.linkedin.experience.map(role => role.company)).toEqual(['Northwind Labs', 'Northwind Labs', 'Contoso Analytics', 'Fabrikam Studio'])
  expect(profile.profileSources.resolved.map(item => item.value)).toEqual(['2022-12'])
})
