import { test, expect } from './fixtures'
import { choose, panel } from './ui'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

test('Jobs: pending load is visible and resolves through the real backend', async ({ workspace, page }) => {
  await workspace.go('Search')
  await workspace.fault('jobs', 'hold')
  await page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: 'Jobs', exact: true }).click()
  await expect(page.getByLabel('Loading workspace')).toBeVisible()
  await workspace.release()
  await workspace.ready('Jobs')
  await expect(page.getByRole('heading', { name: 'No opportunities yet' })).toBeVisible()
})

test('Settings: missing compiler is reported and preview is disabled', async ({ workspace, page }) => {
  writeFileSync(join(workspace.home, 'bin', 'lualatex'), '#!/usr/bin/env node\nprocess.exit(4)\n', { mode: 0o700 })
  await workspace.go('Settings')
  await page.getByRole('tab', { name: 'Resume sources', exact: true }).click()
  await choose(page, 'Compiler', 'LuaLaTeX')
  await page.getByRole('button', { name: 'Save sources' }).click()
  await expect(page.getByText('Resume sources saved.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Install these tools.*lualatex/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update base PDF' })).toBeDisabled()
})

test('Settings: a running preview can be cancelled without leaving a compiler process', async ({ workspace, page }) => {
  // Only this cancellation scenario holds an external compiler; normal PDF tests use real LaTeX.
  const real = execFileSync('which', ['latexmk'], { encoding: 'utf8' }).trim()
  const marker = join(workspace.home, 'compiler.pid')
  writeFileSync(join(workspace.home, 'bin', 'latexmk'), `#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');\nif(process.argv.includes('--version'))process.exit(spawnSync(${JSON.stringify(real)},['--version'],{stdio:'inherit'}).status);\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);\n`, { mode: 0o700 })
  await workspace.go('Settings')
  await page.getByRole('tab', { name: 'Resume sources', exact: true }).click()
  await page.getByRole('button', { name: 'Update base PDF' }).click()
  await expect.poll(() => existsSync(marker)).toBe(true)
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Cancelled')
  await expect(page.getByRole('button', { name: 'Update base PDF' })).toBeEnabled()
  const pid = Number(readFileSync(marker, 'utf8'))
  await expect.poll(() => { try { process.kill(pid, 0); return false } catch { return true } }).toBe(true)
})

test('Settings: active agent blocks browser sign-in and resume writes until cancellation', async ({ workspace, page }) => {
  workspace.setScenario({ agent: 'hold' })
  await workspace.go('Launch')
  await page.getByLabel('Role, keywords or job URL').fill('React')
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByText('Synthetic agent is working.', { exact: true })).toBeVisible()
  await workspace.go('Settings')
  await page.getByRole('button', { name: 'Open sign-in browser' }).click()
  await expect(panel(page, 'Browser sign-in').getByRole('alert')).toContainText('Finish or cancel')
  await page.getByRole('tab', { name: 'Resume sources', exact: true }).click()
  await page.getByLabel('Main .tex file').fill('other.tex')
  await expect(page.getByRole('button', { name: 'Save sources' })).toBeDisabled()
  await workspace.go('Launch')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeEnabled()
})
