import { test, expect } from './fixtures'
import { join } from 'node:path'
import { writeTextPdf } from './fixtures/pdf'
import { jobCard, openJob, panel, resumeCard } from './ui'

test('Resume match: Jobs shows the best saved resume per job, the detail lists its terms and Apply lists it first with its score', async ({ workspace, page }) => {
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
  // Without a triage score each card shows its best resume's match in the band's color.
  const match = (title: string) => jobCard(page, title).getByRole('meter', { name: 'Resume match' })
  await expect(match('Dotnet Engineer')).toHaveAttribute('aria-valuenow', '90')
  await expect(match('Dotnet Engineer')).toHaveAttribute('data-tone', 'good')
  await expect(match('Node Engineer')).toHaveAttribute('aria-valuenow', '100')

  await openJob(page, 'Dotnet Engineer')
  await expect(page.getByRole('dialog')).toContainText('90 · Back-End · C#, .NET')
  await expect(page.getByRole('dialog')).toContainText('Strong match')
  const detail = page.getByRole('region', { name: 'Resume match' })
  await expect(detail.getByRole('listitem', { name: 'Back-End · C#, .NET' })).toContainText('Missing: Docker')
  await expect(detail.getByRole('listitem', { name: 'Back-End · Node.js' })).toContainText('Missing: C# (required), .NET (required), SQL Server (required)')
  await expect(detail).toContainText('It does not predict a hiring decision.')
  await page.keyboard.press('Escape')

  const id = workspace.query("SELECT id FROM jobs WHERE linkedin_job_id = '9501'")[0]!.id
  await workspace.visit(`/apply?jobId=${id}`, 'Application')
  // The Resume step lists the base resume, then the saved resumes from the best match for this job.
  const cards = panel(page, 'Choose a resume').locator('button[aria-pressed]')
  await expect.poll(() => cards.evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(['Base resume', 'Back-End · C#, .NET', 'Back-End · Node.js'])
  await expect(resumeCard(page, 'Back-End · C#, .NET').locator('[role="img"]')).toHaveAttribute('aria-label', 'Match with this job: 90 · Strong match')
  expect(workspace.query('SELECT COUNT(*) AS n FROM ats_scores')[0]!.n).toBeGreaterThanOrEqual(4)
})
