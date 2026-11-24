import { test, expect } from './fixtures'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('Profile sources: import the LinkedIn export, decide a conflict and tailor with the consolidated profile', async ({ workspace, page }) => {
  test.setTimeout(150_000)
  const profileDir = join(workspace.repository, 'base', 'data')
  copyFileSync('src/test/fixtures/profile/linkedin-export.pdf', join(profileDir, 'linkedin-export.pdf'))
  writeFileSync(workspace.dataFile, JSON.stringify({ skills: ['React', 'TypeScript'], work: [{ company: 'Northwind Labs', start: '2022-11', end: 'Present' }, { company: 'Fabrikam Studio', start: '2017', end: '2019-05' }] }))

  await workspace.go('Profile')
  await page.getByRole('tab', { name: 'Base resume' }).click()
  await expect(page.getByLabel('Profile folder')).toHaveValue(profileDir)
  const files = page.getByRole('list', { name: 'Profile files' })
  await expect(files.getByRole('listitem').filter({ hasText: 'linkedin-export.pdf' })).toContainText('Not imported yet')
  await page.getByRole('button', { name: 'Import again' }).click()
  await expect(files.getByRole('listitem').filter({ hasText: 'linkedin-export.pdf' })).toContainText('LinkedIn exportImported')
  await expect(files.getByRole('listitem').filter({ hasText: 'resume-data.json' })).toContainText('Data fileImported')
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
