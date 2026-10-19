import { test, expect, type Workspace } from './fixtures'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

test.use({ populated: true })

const backendPid = (workspace: Workspace) => existsSync(join(workspace.home, 'backend.lock')) ? JSON.parse(readFileSync(join(workspace.home, 'backend.lock'), 'utf8')).pid as number : undefined
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

test('Backend: an unexpected exit is shown and recovered without closing the window', async ({ workspace, page }) => {
  workspace.setScenario({ agent: 'hold' })
  await workspace.go('Launch')
  await page.getByLabel('Role, keywords or job URL').fill('React')
  await page.getByRole('button', { name: 'Run agent' }).click()
  await expect(page.getByText('Synthetic agent is working.', { exact: true })).toBeVisible()
  const agentPid = workspace.calls('prompt')[0]!.pid as number

  const pid = backendPid(workspace)!
  process.kill(pid, 'SIGKILL')
  const alert = page.getByRole('alert').filter({ hasText: 'Backend unavailable' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('The backend stopped unexpectedly')
  await expect.poll(() => page.evaluate(() => window.desktop!.connectionStatus())).toBe(false)
  // The agent belonged to the stopped backend and ends with it.
  await expect.poll(() => alive(agentPid)).toBe(false)

  await alert.getByRole('button', { name: 'Restart backend' }).click()
  await expect(alert).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.desktop!.connectionStatus())).toBe(true)
  const restarted = backendPid(workspace)
  expect(restarted).toBeDefined()
  expect(restarted).not.toBe(pid)
  expect(await page.evaluate(() => window.desktop!.backendStatus!())).toMatchObject({ status: 'ready', restarts: 1 })

  // The active run is reported as interrupted and is not started again.
  await expect(page.getByRole('log', { name: 'Agent conversation' }).getByText('Interrupted', { exact: true })).toBeVisible()
  await expect(page.getByText('Interrupted', { exact: true })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Run agent' })).toBeEnabled()
  expect(workspace.calls('prompt')).toHaveLength(1)

  // Navigation and live updates keep working against the new backend.
  await workspace.go('Jobs')
  await expect(page.getByRole('cell').filter({ hasText: 'Engineer 01' })).toBeVisible()
  await workspace.go('Activity')
  await page.getByLabel('Search Activity').fill('Recovered backend')
  workspace.cli(['activity', 'log', '--summary', 'Recovered backend activity', '--skill', 'synthetic'])
  await expect(page.getByRole('cell', { name: 'Recovered backend activity', exact: true })).toHaveCount(1)
  await workspace.go('Dashboard')
  expect(workspace.calls('prompt')).toHaveLength(1)
  expect(readFileSync(join(workspace.home, 'logs', 'backend.log'), 'utf8')).toContain('The backend stopped unexpectedly')
})
