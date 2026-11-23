# Agent tool decisions

ACP tool requests wait for a human decision. The permission banner remains
available across pages; **Decide later** keeps the request pending without
blocking navigation. Open **Request context** to inspect the tool input, execution
and session. The agent's options are shown verbatim, and the chosen `optionId`
is returned unchanged. **Cancel request**, expiry after five minutes, run
cancellation, process exit and loss of the last dashboard connection never
select an approval. Restarting the backend marks abandoned requests cancelled.

Partial ACP v1 permission updates reuse the previously streamed tool context.
If no earlier context exists, a generic tool-call prompt still requires a
decision and cannot create a remembered rule.

Settings → Permissions shows the last 100 requests and decisions, persistent
rules and rules remembered for the current ACP session. History lives in the
existing SQLite activity log. Persistent rules live in SQLite metadata; saving
a decision and its rule is one transaction. Neither action updates application
submission state or authorizes a portal's Submit action.

Remembering requires an exact identifier-shaped tool title, an ACP `read`,
`search` or `fetch` kind and a read-only name such as
`linkedin_get_person_profile`. Rules match both provider and exact tool name.
Prose titles, commands, browser clicks and tools with sending/submission names
always require a decision. Automatic decisions use only an offered
`allow_once` option; no option is invented. This conservative fallback also
applies to tools that do not provide a reliable identity. Revoking a rule in
Settings restores prompting; session rules are cleared when that ACP session
ends. Submission confirmation remains a separate action in the application detail.

## API for execution consumers

All endpoints require the backend API token, like other workspace endpoints.

- `GET /api/acp/permissions`: `execution`, `pending`, `history`, `rules`, `sessionRules`.
  Each pending request includes a unique `id`, `runId`, `sessionId`, provider,
  tool, readable context, exact options and timestamps. Dashboard runs also get
  a unique execution ID; Apply uses its persisted run ID. `execution` exposes
  the latest execution ID, ACP session and status, including waiting and terminal
  states, so reconnecting dashboards can recover after missed events.
- `POST /api/acp/permissions/answer`: `{ id, runId, sessionId, optionId?,
  remember?: "once" | "session" | "persistent" }`. Omitting `optionId` cancels
  the request. Invalid choices return 400; duplicate, expired or stale
  execution/session responses return 409. Storage failure returns 500 and does
  not release an approval.
- `POST /api/acp/permissions/rule`: `{ provider, tool, enabled, sessionId? }`.
  Omit `sessionId` for persistent rules. Session rules can only be revoked here;
  creating one requires an explicit permission approval.
- WebSocket events: `acp-permission`, `acp-permission-decision` (with `request`),
  and `acp-status` with `waiting_for_permission`, `runId`, `sessionId`.
  `changed` with table `agent_permissions` tells consumers to refresh snapshots.
- Apply's preparation details expose `decisionStatus: "waiting_for_permission"`
  on an active run while its permission is pending. The execution remains busy
  and cancellable. This additive field and the snapshot support future queue
  and central activity consumers without conflating waiting with completion.

Tests use synthetic ACP processes and temporary workspaces; no real
applications or personal profiles are accessed.

## Posting text

Job descriptions are third-party text. Before any agent reads one, Work Tracker
removes hidden content and invisible characters and records a posting check
verdict; see [manual-jobs.md](manual-jobs.md#verificação-de-integridade-da-descrição).
The check advises and never changes these tool decisions: prompt-level rules are
not a sandbox.
