# Frontend implementation task

Implement the existing workspace routes using the existing HTTP and WebSocket contracts in `src/server`, preserving the sidebar, typography, neutral cards and blue chart palette. Backend sources are out of scope.

| Route | Data / capabilities |
| --- | --- |
| /dashboard | overview, metrics, upcoming interviews, activity |
| /profile | profile, profile-snapshot, metrics; launch profile audit |
| /search | LinkedIn job / people search, job details; launch deep scout |
| /launch | ACP providers/models, skill parameters, streamed output, cancel |
| /recruiters | recruiters, due actions, preview/apply acceptance sync |
| /outreach | funnel, due queue, company cooldowns, InMail budget |
| /jobs | saved jobs, filters, details, tailoring |
| /applications | application status, scores, artifacts, portal details |
| /answers | reusable answers, create/edit through POST /api/answer |
| /interviews | schedule, stage, status, notes |
| /activity | activity timeline and filters |
| /settings | appearance, local agent preferences, connection status |

Acceptance: real data, loading/error/empty states, accessible controls, live invalidation, preserved shell, typecheck and tests, browser validation. Desktop integration may change to expose the existing API securely; no API or database changes. The API does not expose generic CRUD, config writes, file downloads or interactive ACP replies; the UI must not invent those capabilities.

## Delivered

- All 12 routes are implemented against the existing API; invoice demo data is no longer used by the dashboard.
- Shared shadcn-style components, searchable and paginated tables, record details, light/dark appearance, responsive layouts, loading/error/empty states.
- Electron IPC bridge authenticates HTTP requests in the main process, restricts routes, opens web links safely, and forwards WebSocket events with reconnection. The renderer never receives the backend token.
- Launch supports all eight existing skill prompts, provider/model discovery, context, streamed messages/tool activity, cancellation and state retained during navigation.
- Settings stores device preferences; backend configuration is not modified. API read-only resources remain read-only, with agent handoffs where supported.

## Validation

- `npm run build`: passed, including both TypeScript projects.
- Backend suite: 327 tests passed. Frontend suite: 30 tests passed (11 new workflow/session tests).
- Chrome MCP: inspected Mercury, visited all 12 implemented routes, checked empty/populated views and dark/responsive layout, created an answer against an isolated real backend.
- Electron runtime: confirmed preload/IPC, authenticated job retrieval, live WebSocket status and rejection of unsupported API paths.
- `git diff --check`: passed. No changes under `src/`.
- Browser validation used a temporary preview bridge and temporary workspace outside the repository. External LinkedIn searches and full ACP provider runs were not executed; their requests, failures and streaming contracts are covered by frontend tests. No outreach was sent.
