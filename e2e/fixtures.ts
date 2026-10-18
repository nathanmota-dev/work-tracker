import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

export { expect }
export type Call = { kind: string; [key: string]: unknown }
export type Scenario = { agent?: 'error' | 'hold' | 'login' | 'invalid-latex' | 'permission'; mcp?: 'error' | 'empty' | 'text' | 'login' | 'mixed' | 'prose' | 'structured'; chrome?: 'error' }
export class Workspace {
  readonly home = mkdtempSync(join(tmpdir(), 'work tracker e2e '))
  readonly repository = join(this.home, 'repository')
  readonly project = join(this.repository, 'base', 'latex')
  readonly dataFile = join(this.repository, 'base', 'data', 'resume-data.json')
  readonly env: Record<string, string>
  app!: ElectronApplication
  page!: Page
  readonly logs: string[] = []
  readonly errors: string[] = []
  private stopping = false
  constructor() {
    mkdirSync(this.project, { recursive: true })
    mkdirSync(join(this.repository, 'base', 'data'), { recursive: true })
    copyFileSync('e2e/fixtures/resume.tex', join(this.project, 'resume.tex'))
    writeFileSync(this.dataFile, JSON.stringify({ skills: ['React', 'TypeScript'] }))
    this.env = Object.fromEntries(Object.entries({ ...process.env,
      WORK_TRACKER_HOME: this.home, WORK_TRACKER_REPO_ROOT: this.repository,
      WORK_TRACKER_CLI: resolve('out/cli/work-tracker.cjs'),
      E2E_NODE: process.execPath, TZ: 'UTC', OPENCODE_CONFIG_CONTENT: '{}',
      XDG_CONFIG_HOME: join(this.home, 'config'), XDG_DATA_HOME: join(this.home, 'data'), XDG_CACHE_HOME: join(this.home, 'cache'),
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    delete this.env.ELECTRON_RUN_AS_NODE
    delete this.env.WORK_TRACKER_SMOKE
    delete this.env.ELECTRON_RENDERER_URL
    this.cli(['init'])
    const fakeChrome = join(this.home, 'chrome.cjs')
    copyFileSync('e2e/fixtures/chrome.cjs', fakeChrome)
    chmodSync(fakeChrome, 0o700)
    const protocol = resolve('e2e/fixtures/protocol.cjs')
    const config = {
      username: "synthetic-candidate",
      acp: Object.fromEntries(['opencode', 'claude-code'].map(provider => [provider, { command: process.execPath, args: [protocol], env: { E2E_PROVIDER: provider } }])),
      mcp: { linkedin: { command: process.execPath, args: [protocol] }, chrome: { command: process.execPath, args: [protocol, '--executable-path', fakeChrome] } },
    }
    writeFileSync(join(this.home, 'config.json'), JSON.stringify(config))
    writeFileSync(join(this.home, 'calls.jsonl'), '')
    this.setScenario({})
  }
  cli(args: string[]) {
    return execFileSync(process.execPath, [resolve('out/cli/work-tracker.cjs'), ...args], { env: this.env, encoding: 'utf8', timeout: 30_000 })
  }
  query(sql: string) {
    const db = new DatabaseSync(join(this.home, 'work-tracker.db'))
    try { return db.prepare(sql).all() as Record<string, unknown>[] } finally { db.close() }
  }
  seed() {
    const db = new DatabaseSync(join(this.home, 'work-tracker.db'))
    try {
      db.prepare("INSERT INTO profile (id, username, name, headline, location) VALUES (1, 'synthetic-candidate', 'Synthetic Candidate', 'React Engineer', 'Remote')").run()
      for (let i = 1; i <= 17; i++) {
        db.prepare('INSERT INTO jobs (id, linkedin_job_id, title, company_name, location, work_type, fit, status, link, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(i, String(1000 + i), `Engineer ${String(i).padStart(2, '0')}`, `Company ${i}`, 'Remote', 'remote', 'strong', i % 2 ? 'saved' : 'assessed', `https://example.com/jobs/${i}`, 'React developer')
        db.prepare("INSERT INTO activity_log (kind, skill, summary) VALUES ('skill-run', 'job-scout', ?)").run(`Seed activity ${i}`)
        db.prepare('INSERT INTO applicant_answers (key, value, category) VALUES (?, ?, ?)').run(`custom_${String(i).padStart(2, '0')}`, `Answer ${i}`, 'custom')
        db.prepare("INSERT INTO recruiters (name, username, company, status) VALUES (?, ?, ?, 'pending')").run(i === 1 ? 'Alex Recruiter' : `Recruiter ${i}`, i === 1 ? 'alex-recruiter' : `recruiter-${i}`, 'Example Company')
        db.prepare("INSERT INTO applications (job_id, status, company_name, role_title, external_url, current_stage_id, tracking_status, stack_json, applied_at, created_at, updated_at, keyword_score) VALUES (?, 'draft', ?, ?, ?, 1, 'active', '[\"React\"]', ?, ?, ?, ?)").run(i, `Company ${i}`, `Engineer ${String(i).padStart(2, '0')}`, `https://example.com/jobs/${i}`, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), i === 1 ? 0 : null)
      }
      const future = new Date(Date.now() + 30 * 86400_000).toISOString()
      const past = new Date(Date.now() - 30 * 86400_000).toISOString()
      db.prepare("INSERT INTO interviews (company, scheduled_at, stage, status, notes) VALUES ('Future Company', ?, 'technical', 'scheduled', 'Practice React'), ('Past Company', ?, 'recruiter', 'closed', 'Closed conversation')").run(future, past)
      db.prepare("INSERT INTO profile_metrics (captured_at, score, profile_views, search_appearances, connections, breakdown_json) VALUES (?, 0, 0, 0, 0, '[{\"label\":\"Headline\",\"value\":\"Needs detail\"}]')").run(past)
      db.prepare("INSERT INTO outreach_attempts (person_username, person_name, company_urn, company_name, state, sent_at, next_action_due) VALUES ('due-person', 'Due Person', '1234', 'Example Company', 'invited', ?, ?), ('blocked-person', 'Blocked Person', '5678', 'Cooldown Company', 'do_not_contact', ?, NULL)").run(past, past, past)
    } finally { db.close() }
  }
  setScenario(scenario: Scenario) {
    writeFileSync(join(this.home, 'scenario.json'), JSON.stringify(scenario))
  }
  calls(kind?: string): Call[] {
    const values = readFileSync(join(this.home, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Call)
    return kind ? values.filter(value => value.kind === kind) : values
  }
  async start() {
    this.stopping = false
    const displayArgs = this.env.WORK_TRACKER_XVFB_ACTIVE === '1' ? ['--ozone-platform=x11'] : []
    this.app = await _electron.launch({ args: ['.', '--no-sandbox', ...displayArgs, `--user-data-dir=${join(this.home, 'electron')}`], env: this.env, locale: 'en-US', timezoneId: 'UTC', timeout: 30_000 })
    this.app.process().stdout?.on('data', data => this.logs.push(String(data)))
    this.app.process().stderr?.on('data', data => this.logs.push(String(data)))
    this.app.on('close', () => { if (!this.stopping) this.errors.push('Electron closed unexpectedly') })
    expect(await this.app.evaluate(({ app }) => app.getPath('userData'))).toContain(this.home)
    if (displayArgs.length) {
      expect(await this.app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform'))).toBe('x11')
      expect(await this.app.evaluate(() => process.env.DISPLAY)).toBe(this.env.DISPLAY)
    }
    this.page = await this.app.firstWindow()
    this.page.on('crash', () => this.errors.push('Renderer crashed'))
    this.page.on('pageerror', error => this.errors.push(error.message))
    this.page.on('console', message => { if (message.type() === 'error') this.logs.push(`renderer: ${message.text()}`) })
    await this.app.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.fulfill({ status: 404, body: '' }))
    await this.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    await this.app.evaluate(({ dialog, shell }) => {
      const state = globalThis as typeof globalThis & { e2eExternal?: string[]; e2eOpen?: string[]; e2eSave?: string }
      state.e2eExternal = []
      shell.openExternal = async url => { state.e2eExternal!.push(url) }
      dialog.showOpenDialog = async () => ({ canceled: !state.e2eOpen, filePaths: state.e2eOpen ?? [] })
      dialog.showSaveDialog = async () => ({ canceled: !state.e2eSave, filePath: state.e2eSave ?? "" })
    })
    await expect.poll(() => this.page.evaluate(() => window.desktop!.connectionStatus())).toBe(true)
    await this.ready('Dashboard')
  }
  async ready(title: string) {
    // Restored record dialogs hide the page heading from the accessibility tree.
    await expect(this.page.getByRole('heading', { name: title, exact: true, level: 1, includeHidden: true })).toBeVisible()
    await expect(this.page.getByLabel('Loading workspace')).toHaveCount(0)
  }
  async go(title: string) {
    const link = this.page.locator('[data-sidebar="sidebar"]').getByRole('link', { name: title, exact: true })
    await expect(async () => {
      const open = this.page.getByRole('button', { name: 'Abrir sidebar', exact: true })
      if (!await link.isVisible() && await open.isVisible()) await open.click()
      // Resizing can replace the desktop sidebar with its mobile dialog mid-action.
      await link.click({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    await this.ready(title)
  }
  async restart() { await this.stop(); await this.start() }
  async stop() { this.stopping = true; if (this.app) await this.app.close() }
  async fault(path: string, mode: 'error' | 'hold' = 'error') {
    await this.app.evaluate((_electron, args) => {
      const state = globalThis as typeof globalThis & { e2eRelease?: () => void }
      const original = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        if (new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname !== `/api/${args.path}`) return original(input, init)
        globalThis.fetch = original
        if (args.mode === 'error') return new Response(JSON.stringify({ error: 'Synthetic transport failure' }), { status: 503, headers: { 'content-type': 'application/json' } })
        await new Promise<void>(resolve => { state.e2eRelease = resolve })
        return original(input, init)
      }
    }, { path, mode })
  }
  async release() { await this.app.evaluate(() => (globalThis as typeof globalThis & { e2eRelease?: () => void }).e2eRelease?.()) }
  async picker(paths?: string[], save?: string) { await this.app.evaluate((_electron, value) => Object.assign(globalThis, { e2eOpen: value.paths, e2eSave: value.save }), { paths, save }) }
  async external() { return this.app.evaluate(() => (globalThis as typeof globalThis & { e2eExternal: string[] }).e2eExternal) }
  async resize(width: number) { await this.app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 800), width) }
}

type Fixtures = { workspace: Workspace; page: Page; populated: boolean }
export const test = base.extend<Fixtures>({
  populated: [false, { option: true }],
  workspace: async ({ populated }, use, info) => {
    const workspace = new Workspace()
    let started = false
    try {
      if (populated) workspace.seed()
      await workspace.start()
      started = true
      await use(workspace)
      expect(workspace.errors, 'Unexpected renderer errors').toEqual([])
    } finally {
      const failed = info.status !== info.expectedStatus || workspace.errors.length > 0
      try {
        if (started && failed && !workspace.page.isClosed()) await info.attach('screenshot', { body: await workspace.page.screenshot(), contentType: 'image/png' })
        if (started) {
          const path = failed ? info.outputPath('trace.zip') : undefined
          await workspace.app.context().tracing.stop({ path })
          if (path) await info.attach('trace', { path, contentType: 'application/zip' })
        }
        if (failed) {
          await info.attach('app.log', { body: workspace.logs.join(''), contentType: 'text/plain' })
          await info.attach('calls.jsonl', { body: readFileSync(join(workspace.home, 'calls.jsonl')), contentType: 'application/jsonl' })
        }
      } finally {
        try { await workspace.stop(); expect(existsSync(join(workspace.home, 'backend.lock'))).toBe(false) }
        finally { rmSync(workspace.home, { recursive: true, force: true }) }
      }
    }
  },
  page: async ({ workspace }, use) => use(workspace.page),
})
