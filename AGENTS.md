# Work Tracker

Work Tracker is an Electron desktop app for managing the job-search process. It helps users discover job opportunities on LinkedIn, save and track roles, organize applications, and keep related job-search activity such as recruiter outreach, interviews, and profile metrics in one place. LinkedIn and browser automation are provided through configurable MCP integrations, while compatible coding agents can be connected through ACP.

## Technology stack

- Desktop shell: Electron, built with electron-vite.
- Backend and CLI: TypeScript on Node.js 24+, with an HTTP and WebSocket API.
- Persistence: SQLite through Node.js's built-in `node:sqlite` module.
- Integrations: Model Context Protocol SDK (`@modelcontextprotocol/sdk`), WebSocket support (`ws`), configurable LinkedIn and Chrome MCP servers, and ACP agent processes.
- Frontend: Vite, React, Tailwind CSS, shadcn/ui components, and TanStack Router.
- Tests: Vitest is used for both backend and frontend tests. Backend tests run in Node; frontend tests use jsdom and Testing Library.

## Agent instructions

When a task requires creating a Git branch, commit, or pull request, follow the `git-pr-conventions` skill at `.agents/skills/git-pr-conventions/SKILL.md`.
