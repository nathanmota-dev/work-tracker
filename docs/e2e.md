# Electron E2E

The Playwright suite runs the compiled desktop app on Linux, with real preload,
IPC, HTTP/WebSocket backend, SQLite, CLI writes, LaTeX compilation and PDF.js.
Run `npm run test:e2e` to rebuild and test. For an already current production
build, use `npm run test:e2e:run -- <file or Playwright filters>`.
`npm run test:e2e:debug` opens the inspector and `npm run test:e2e:report` opens
the last HTML report. Electron includes Chromium; a separate browser download is
not required. A graphical session or Xvfb is required.

Install Node 24+, npm dependencies, latexmk, pdfLaTeX and Poppler. On Ubuntu 24.04,
the CI workflow installs Playwright's Chromium system dependencies plus Xvfb,
GTK3, latexmk, texlive-latex-base and poppler-utils. The synthetic two-page resume
uses the standard article class. Existing Apply smoke checks use the example
resume and retain their additional font/package requirements.

## Isolation and external integrations

Every test initializes its own temporary `WORK_TRACKER_HOME`, repository root,
Electron user-data directory and XDG directories. Tests assert the user-data path
is isolated. Restart tests deliberately reuse their own data. The fixture closes
Electron, checks backend.lock removal and removes temporary files in teardown.
No test imports a personal resume or uses a real ACP executable or MCP server.

`e2e/fixtures/protocol.cjs` speaks JSON-RPC over stdio for both configured ACP
providers and LinkedIn MCP. Agent responses stream through the real backend and
WebSocket. Scripted agents save records through the real CLI or write managed
resume/portal result files consumed by the backend. Calls, prompts, provider and
model are recorded per workspace in calls.jsonl. Unexpected methods/tools fail.
`workspace.setScenario` selects success, empty results, external errors, held
agent turns, pending sign-in or invalid LaTeX. Scenarios are test-owned files,
not application endpoints or production flags.

The fake Chrome executable implements the local DevTools startup handshake and
records its arguments; it never opens LinkedIn. Native Electron file dialogs and
shell.openExternal are stubbed in the main process, with actual PDF writes still
verified. Renderer HTTP(S) assets receive local 404 responses, exercising favicon
fallbacks without contacting sites. Transport-error tests replace one specific
main-process fetch response; subsequent requests use the original fetch.

## Coverage inventory

All 14 sidebar links are compared with an explicit inventory. Every view runs
with both empty and populated workspaces, including navigation, active sidebar,
breadcrumb, view-specific content and reload. New sidebar entries require tests.

| View | Functional coverage |
| --- | --- |
| Dashboard | Counts, upcoming calendar, activity, links and live CLI notifications |
| Profile | Saved identity, metrics/score, audit handoff and candidate reuse |
| Search | Jobs/people, filters, company URN, details, empty/error/retry and assessment → saved job |
| Launch | Every selectable skill, provider/model/context, streaming/tool details, clear, errors, cancellation, sign-in retry and navigation during a run |
| Recruiters | Details/external links, preview/apply/no-change sync, agent handoffs |
| Outreach | Due actions, cooldowns, funnel/budget rendering, filtering and follow-up handoff |
| Apply | Sources, description, real two-page PDFs, generation/regeneration/history, report, viewer controls/export, failed output preservation, cancel, fill/sign-in/retry and explicit submission |
| Jobs | Pagination, search/status filters, archive/restore, failed mutation, deletion confirmation/cancel, linked-record protection and Apply handoff |
| Automatic applications | Records, zero score, details/portal, status updates and preserved preparation IDs |
| Application board | Minimal/full registration, failed edits, search, pointer drag/stage selection, failed-move rollback, timeline, all archive reasons/reopen and stage management/protections |
| Answers | Add/edit, required/duplicate keys, failure/retry, cancel and realtime updates |
| Interviews | Upcoming/past/closed, details/search, live updates and Dashboard link |
| Activity | Pagination/search/reset, real CLI notifications and reload persistence |
| Settings | Tabs, theme/preferences persistence, profile validation/save/discard, source pickers/preview/download and browser sign-in error/retry |

All data-backed views also exercise failed loading and retry. Search errors are
exercised through MCP. Shell tests cover the root redirect, collapsed sidebar,
command palette, keyboard selection, history and a narrow window/PDF tabs.

Keep journeys independent; do not rely on test ordering or share databases. Use
accessible locators and real pointer events for drag and drop. Read database state
only to verify persistence; perform the action under test through the UI. Existing
unit/integration suites continue to cover exhaustive validation and backend rules.

## Failure evidence and CI

One worker and zero retries keep failures visible. Tests use condition-based
assertions, not fixed sleeps. Unexpected renderer exceptions/crashes and premature
Electron closure fail the test. Failed tests attach screenshots, manually recorded
Electron-context traces, application output and the mock call transcript. Reports
and test-results are ignored by Git. The Electron E2E workflow runs on pull requests
to main with Xvfb, and uploads HTML reports/evidence for seven days. It no longer
runs on pushes or merges to main; see `docs/ci.md` for the other PR workflows.

The repository's complete mandatory verification sequence remains in AGENTS.md,
with the E2E suite added after the existing checks. The installed app is updated
only after all checks pass in the main worktree.
