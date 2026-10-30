# Electron E2E

The Playwright suite runs the compiled desktop app on Linux, with real preload,
IPC, HTTP/WebSocket backend, SQLite, CLI writes, LaTeX compilation and PDF.js.
Run `npm run test:e2e` to rebuild and test. For an already current production
build, use `npm run test:e2e:run -- <file or Playwright filters>`.
`npm run test:e2e:debug` opens the inspector and `npm run test:e2e:report` opens
the last HTML report. Electron includes Chromium; a separate browser download is
not required. On Linux, normal E2E runs automatically use Xvfb, even when a
desktop session is available. Electron windows remain on the virtual display,
so tests do not cover other applications or take their focus. The terminal still
streams progress and waits for the test result.

Install `xvfb` and `xauth` (`sudo apt-get install xvfb xauth` on Ubuntu).
The launcher checks for `Xvfb`, `xvfb-run` and `xauth`; missing tools fail with
installation instructions before Electron starts. Each run uses an available
display number and a 1920×1080, 24-bit screen. The test processes use X11
explicitly, including on Wayland desktops. The host environment is preserved.

`test:e2e:debug`, `--debug`, `--ui` and an active `PWDEBUG` use the host display
for interactive inspection. To make any E2E or smoke command visible explicitly:

```bash
WORK_TRACKER_TEST_DISPLAY=host npm run test:e2e:run -- e2e/apply.spec.ts
WORK_TRACKER_TEST_DISPLAY=host node scripts/smoke-electron.mjs
```

`WORK_TRACKER_TEST_DISPLAY=xvfb` selects the normal Linux default;
interactive debugging still uses the host display. Windows and macOS use
direct launch and require their native graphical session.

Both `scripts/smoke-electron.mjs` and `scripts/smoke-apply.mjs` use the same
launcher automatically, for built Electron, electron-vite development mode and
AppImage commands. Arguments, including paths with spaces, are forwarded intact.
Ctrl+C and SIGTERM trigger cleanup of owned Electron processes and the virtual
display; the supervisor allows five seconds before forcing termination.

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

All 14 sidebar links are compared with an explicit ordered inventory: Overview (Dashboard), Find (Search, Jobs), Apply & track (Applications, Application board, Apply, Interviews), People (Recruiters, Outreach), You (Profile, Answers), and the Tools footer (Agent, Activity, Settings). Agent retains the /launch path. Every view runs
with both empty and populated workspaces, including navigation, active sidebar,
breadcrumb, view-specific content and reload. New sidebar entries require tests.

| View | Functional coverage |
| --- | --- |
| Dashboard | Counts, upcoming calendar, activity, links and live CLI notifications |
| Profile | Saved identity, metrics/score, audit handoff and candidate reuse |
| Search | Jobs/people, filters, company URN, details, empty/error/retry and assessment → saved job |
| Agent | Every selectable skill, provider/model/context, streaming/tool details, clear, errors, cancellation, sign-in retry and navigation during a run |
| Recruiters | Details/external links, preview/apply/no-change sync, agent handoffs |
| Outreach | Due actions, cooldowns, funnel/budget rendering, filtering and follow-up handoff |
| Apply | Sources, description, real two-page PDFs, generation/regeneration/history, report, viewer controls/export, failed output preservation, cancel, fill/sign-in/retry and explicit submission |
| Jobs | Pagination, search/status filters, archive/restore, failed mutation, deletion confirmation/cancel, linked-record protection and Apply handoff |
| Applications | Preparation/Tracking/Archived views, origin and step labels, journey counts shared with Jobs and Dashboard, records, zero score, details/portal, status updates, preserved preparation IDs, creating the job of a manual application (missing data, failed link/retry, Apply with the same IDs) and legacy review (safe fixes, explicit choice between ambiguous jobs) |
| Application board | Minimal/full registration (optionally linked to a saved job), failed edits, search, pointer drag/stage selection, failed-move rollback, timeline, all archive reasons/reopen and stage management/protections |
| Answers | Add/edit, required/duplicate keys, failure/retry, cancel and realtime updates |
| Interviews | Upcoming/past/closed, details/search, live updates and Dashboard link |
| Activity | Pagination/search/reset, real CLI notifications and reload persistence |
| Settings | Tabs, theme/preferences persistence, profile validation/save/discard, source pickers/preview/download, browser sign-in error/retry and workspace backup/review/restore (missing folder, copy changed after review, preserved previous workspace) |

All data-backed views also exercise failed loading and retry. Search errors are
exercised through MCP. Shell tests cover the root redirect, collapsed sidebar,
command palette, keyboard selection, history and a narrow window/PDF tabs.
`backend-recovery.spec.ts` kills the backend process during an agent run, checks
the unavailable state, restarts it from the interface, and verifies that the run
is shown as interrupted without a second prompt while navigation, live CLI
updates and the backend log keep working.
`batch-selection.spec.ts` selects a page and filtered results in Jobs, deselects
items, reviews five jobs and creates one batch with shared and overridden context;
it checks that all five resumes reach review without filling or submitting.
`preparation-batch.spec.ts` creates a batch through the desktop API and checks the Apply queue: a form in review reserves the portal
for both the queue and Apply, a pending sign-in and two restarts keep every item's
phase, and a fill interrupted with an unknown outcome is not repeated by resume or
"Retry failed" until the portal review is confirmed.

Keep journeys independent; do not rely on test ordering or share databases. Use
accessible locators and real pointer events for drag and drop. Read database state
only to verify persistence; perform the action under test through the UI. Existing
unit/integration suites continue to cover exhaustive validation and backend rules.

`workspace-context.spec.ts` covers Jobs → Apply → back with URL filters, page,
selection and navigation scroll, isolated context/description drafts after a real
Electron restart, and Search → Launch → Search with retained results and selection.
The manual-job journey also checks that the first generated application's draft
keeps the context entered for its job. Router-backed Vitest tests cover invalid
parameters, removed/archived selection reconciliation, and application attempts;
draft-storage tests cover failed writes without overwriting previous content.
Scroll positions and search output stay in memory for navigation; context drafts
persist in the renderer's local storage, separately from saved job descriptions.

## Failure evidence and CI

One worker and zero retries keep failures visible. Tests use condition-based
assertions, not fixed sleeps. Unexpected renderer exceptions/crashes and premature
Electron closure fail the test. Failed tests attach screenshots, manually recorded
Electron-context traces, application output and the mock call transcript. Reports
and test-results are ignored by Git. The Electron E2E workflow runs on pull requests
to main through the same automatic Xvfb launcher, and uploads HTML reports/evidence
for seven days. It no longer
runs on pushes or merges to main; see `docs/ci.md` for the other PR workflows.

The repository's complete mandatory verification sequence remains in AGENTS.md,
with the E2E suite added after the existing checks. The installed app is updated
only after all checks pass in the main worktree.

### Batch application review

The Application review center opens from a batch in Apply or immediately after
creating one in Jobs. It navigates the batch's fixed item order and keeps the
selected item and unfinished filter in the route, including returns from Answers.
Applications and the application board remain the consultation and filtering views.

Every item contributes once to the batch summary: cancelled, submitted, failed
(including interrupted), pending adjustment, filled, prepared, or otherwise pending,
in that priority order. Preparation and filling never imply submission. Queue and
application events refresh the summary; reconnecting reloads the recorded state.
Adjustments generate a new version from the batch's frozen sources. Failed changes
keep previous documents and approvals, and interrupted fills still require a portal
review before retrying.

`application-review-center.spec.ts` selects five synthetic jobs, recovers agent and
transport failures, requests an adjustment, restarts the app, reviews and fills each
item, and confirms submissions individually. It uses the existing isolated
workspace and ACP/MCP/portal doubles; no real applications are sent. Frontend tests
cover mixed-state navigation, matching PDFs/checklists, context restoration and
permission decisions. Backend integration tests cover summary transitions,
cancellations, retries, preservation of previous PDFs and restart recovery.
