import { test, expect } from './fixtures'
import { jobMenu, selectionBar } from './ui'

/** Opens the direct LinkedIn search of Discover opportunities. */
const discover = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Discover opportunities', exact: true }).click()
  await page.getByRole('tab', { name: 'Search LinkedIn', exact: true }).click()
}

test('Jobs: direct search, bulk triage, archive and duplicate outcomes', async ({ workspace, page }) => {
  await workspace.go('Jobs')
  await discover(page)
  await page.getByLabel('Keywords').fill('React')
  await page.getByLabel('Location', { exact: true }).fill('Remote')
  workspace.setScenario({ mcp: 'mixed' })
  workspace.query("CREATE TRIGGER fail_search AFTER INSERT ON jobs WHEN NEW.title = 'Write failure' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByRole('tab', { name: 'New (2)' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByText('2 saved · 0 already saved · 2 failed')).toBeVisible()
  await expect(page.getByText('Just added')).toHaveCount(2)
  await page.getByRole('checkbox', { name: 'Select React Engineer', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Select New Engineer', exact: true }).check()
  await selectionBar(page).getByRole('button', { name: 'Move to shortlist' }).click()
  await page.getByRole('tab', { name: 'Shortlist (2)' }).click()
  await jobMenu(page, 'New Engineer', 'Archive')
  await expect(page.getByRole('tab', { name: 'Archived (1)' })).toBeVisible()
  await discover(page)
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByText('0 saved · 2 already saved · 2 failed')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'New (0)' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('tab', { name: 'Shortlist (1)' })).toBeVisible()
  await expect(page.getByText('New Engineer: Already saved (archived)')).toBeVisible()
  expect(workspace.query('SELECT * FROM jobs')).toHaveLength(2)
  expect(workspace.calls('prompt')).toHaveLength(0)
  // The criteria stay filled for the next search.
  await discover(page)
  await expect(page.getByRole('button', { name: 'Remove React', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Remote', exact: true })).toBeVisible()
  await workspace.fault('jobs/save-search')
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByRole('alert')).toContainText('Synthetic transport failure')
  // A failed save keeps the criteria on screen to retry.
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByText('0 saved · 2 already saved · 2 failed')).toBeVisible()
})

test('Jobs: prose-only MCP output remains readable', async ({ workspace, page }) => {
  workspace.setScenario({ mcp: 'prose' })
  await workspace.go('Jobs')
  await discover(page)
  await page.getByLabel('Keywords').fill('React')
  await page.getByRole('button', { name: 'Search LinkedIn' }).click()
  await expect(page.getByText(/No savable results/)).toContainText('React Engineer at Example Company')
  expect(workspace.query('SELECT * FROM jobs')).toHaveLength(0)
})
