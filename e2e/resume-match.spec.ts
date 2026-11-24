import { test, expect } from './fixtures'
import { join } from 'node:path'
import { writeTextPdf } from './fixtures/pdf'

test('Resume match: Jobs shows the best saved resume per job, the detail lists its terms and Apply preselects it', async ({ workspace, page }) => {
  await workspace.go('Jobs')
  const resumes = [
    { name: 'Back-End · Node.js', stacks: ['Node.js'], lines: ['Synthetic Candidate', 'Node.js, TypeScript, PostgreSQL and Docker services'] },
    { name: 'Back-End · C#, .NET', stacks: ['C#', '.NET'], lines: ['Synthetic Candidate', 'C#, .NET, ASP.NET Core and SQL Server APIs'] },
  ]
  for (const [index, resume] of resumes.entries()) {
    const path = join(workspace.home, `synthetic-${index}.pdf`)
    writeTextPdf(path, resume.lines)
    await page.evaluate(body => window.desktop!.request('resume-variants/import', body), { name: resume.name, role: 'backend', stacks: resume.stacks, path })
  }
  workspace.cli(['job', 'save', '--linkedin-id', '9501', '--title', 'Dotnet Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9501',
    '--description', 'Requirements:\n- C#\n- .NET\n- SQL Server\nNice to have: Docker'])
  workspace.cli(['job', 'save', '--linkedin-id', '9502', '--title', 'Node Engineer', '--company', 'Example Company', '--link', 'https://example.com/jobs/9502',
    '--description', 'Requisitos: Node.js, TypeScript, PostgreSQL'])
  await workspace.go('Jobs')
  const row = (title: string) => page.getByRole('row').filter({ hasText: title })
  await expect(row('Dotnet Engineer')).toContainText('90 · Back-End · C#, .NET')
  await expect(row('Dotnet Engineer')).toContainText('Strong match')
  await expect(row('Node Engineer')).toContainText('100 · Back-End · Node.js')

  await page.getByRole('button', { name: 'View Dotnet Engineer' }).click()
  const detail = page.getByRole('region', { name: 'Resume match' })
  await expect(detail.getByRole('listitem', { name: 'Back-End · C#, .NET' })).toContainText('Missing: Docker')
  await expect(detail.getByRole('listitem', { name: 'Back-End · Node.js' })).toContainText('Missing: C# (required), .NET (required), SQL Server (required)')
  await expect(detail).toContainText('It does not predict a hiring decision.')
  await page.keyboard.press('Escape')

  const id = workspace.query("SELECT id FROM jobs WHERE linkedin_job_id = '9501'")[0]!.id
  await workspace.visit(`/apply?jobId=${id}`, 'Application')
  await expect(page.getByRole('combobox', { name: /^Saved resume/ })).toContainText('Back-End · C#, .NET — 1 page · 90')
  await expect(page.getByLabel('Resume match (ATS keywords)')).toContainText('90 · Strong match')
  expect(workspace.query('SELECT COUNT(*) AS n FROM ats_scores')[0]!.n).toBeGreaterThanOrEqual(4)
})
