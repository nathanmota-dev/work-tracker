---
name: design-mode
description: Enter design mode for fast UI iteration in Work Tracker. Only frontend/UI files change, the app stays open for live visual review, and the AGENTS.md verification checklist is deferred until the user approves the UI. Use when the user types /design-mode or asks to enter design mode, iterate on the UI, or polish the visual before running checks.
---

# Design mode

Design mode is a fast loop for visual work: change only the UI, keep the app open so the user can look at it, take feedback, adjust, and repeat. The expensive verification runs once, at the end, after the user approves the visual.

## Scope: UI only

While design mode is active, edit only frontend presentation code under `web/src/`:

- components, routes and layouts (`web/src/components`, `web/src/routes`, `web/src/layout`);
- styles, Tailwind classes, `web/src/index.css`, icons and static UI assets in `web/src/public`;
- frontend-only helpers and hooks when they exist purely to support the visual (formatting, layout state).

Do **not** touch, in design mode:

- backend, CLI, Electron main/preload, persistence or API code (`src/`, `desktop/`);
- `scripts/`, `e2e/`, build or runtime configuration, `package.json` and dependencies;
- API contracts, database schema, or data the UI consumes.

If a requested UI change needs a backend or contract change, stop and tell the user. Offer to mock or stub it in the UI for now, or to leave design mode and implement it properly. Do not make the backend change on your own.

Do not update or write tests during the iterations. Tests are fixed in the final verification.

## No checks while iterating

This skill is an explicit exception to the "Mandatory verification before completing a task" section of `AGENTS.md` **until the user approves the UI**. During iterations:

- do not run `typecheck`, `test`, `lint`, `package`, smoke, E2E, coverage, quality or performance commands;
- do not commit, push, or update the installed app;
- do not create a worktree or branch; work in the current checkout.

The only feedback loop allowed is the running app itself: read the dev process output for compile or runtime errors and fix them.

## Workflow

1. **Open the app.** If the dev app is not already running, start it in the background from the repository root with `npm run dev` (Electron with watch and renderer hot reload) and tell the user it is open. Reuse the same process for the whole session; only restart it if it crashes or stops reloading.
2. **Apply the requested UI change.** Keep each round focused on what the user asked.
3. **Report briefly and wait.** Say what changed and where (files or screen area), then wait for the user's feedback. Do not claim it is done or verified.
4. **Iterate.** Apply the user's points (positions, spacing, colors, copy, layout) and go back to step 3. Ask a short question only when a coordinate or reference is genuinely ambiguous.
5. **Exit on approval.** Leave design mode only when the user clearly approves, for example "ok", "aprovado", "tá bom", "pode rodar", or "roda as verificações". Feedback that still asks for changes is not approval.

## After approval

1. Stop the dev app started in step 1.
2. Run the full checklist in `AGENTS.md`, in order, from the repository root. Fix every failure, including tests broken by the UI change, missing test coverage, lint and quality issues, and rerun the affected checks.
3. If a fix would change the approved visual, tell the user before applying it.
4. Commit following `RULES.md` and `.agents/skills/git-pr-conventions/SKILL.md`. Push or open a pull request only when the user asks.
5. Follow the "Final step: update the installed app from main" rules in `AGENTS.md`.
6. Summarize the checks executed and their results, and the installation update result, as `AGENTS.md` requires.
