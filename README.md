# Work Tracker

A desktop app to organize your job search: find roles on LinkedIn, save and
track every opportunity, manage applications, and keep recruiters, interviews,
and profile metrics in one place.

## What it does

- **Job discovery** on LinkedIn, with a fit assessment against your profile.
- **Tracking** of saved roles and applications, from first contact to final answer.
- **Per-role resumes**: generates a resume tailored to each opportunity, compares PDFs, and prepares the application form for you to review and submit.
- **Recruiters and interviews**: contacts, follow-up messages, and interview scheduling.
- **Metrics** for your profile and job search over time.
- **AI agents** connected through ACP (OpenCode and Claude Code), plus LinkedIn and browser access through configurable MCP.

Your data stays on your computer, in `~/.work-tracker`.

## Tech stack

Electron, React, Tailwind CSS, and shadcn/ui on the frontend; TypeScript and
Node.js 24+ on the backend, with SQLite, an HTTP/WebSocket API, Model Context
Protocol, and ACP.

## Installation

Available for **Linux**.

1. Download `work-tracker-X.Y.Z-x86_64.AppImage` from the
   [latest release](https://github.com/nathanmota-dev/work-tracker/releases/latest).
2. Make it executable and run it:

   ```bash
   chmod +x work-tracker-*-x86_64.AppImage
   ./work-tracker-*-x86_64.AppImage
   ```

   If your system blocks the sandbox (common on Ubuntu with AppArmor), run it
   with `--no-sandbox`.

Keep the AppImage in a folder your user can write to: the app checks for
updates automatically, and in **Settings → Updates** you can download and
install the new version with one click. Your data is not changed by updates.

To generate PDF resumes, also install `latexmk`, `pdflatex`, and Poppler
(`pdfinfo` and `pdftotext`). To use agents and LinkedIn, configure the
integrations in **Settings**.

## License

[MIT](LICENSE)
