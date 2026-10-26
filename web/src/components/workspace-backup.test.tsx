import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WorkspaceBackup } from "./workspace-backup"
import { request } from "@/lib/api"
import type { BackupSummary } from "@/lib/backup"
import { desktopDouble } from "@/test/doubles"
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  request: vi.fn(),
}))
const summary: BackupSummary = {
  path: "/backups/work-tracker-backup-1",
  fingerprint: "f".repeat(64),
  createdAt: "2026-10-18T12:00:00.000Z",
  appVersion: "1.0.0",
  schemaVersion: 4,
  counts: { jobs: 3, applications: 2, pdf_artifacts: 1 },
  excluded: [{ kind: "browser-session", path: "/home/browsers", reason: "Sign in again after restoring." }],
  files: 4,
  artifacts: 2,
  bytes: 10,
}
let desktop: ReturnType<typeof desktopDouble>
beforeEach(() => {
  desktop = desktopDouble()
  window.desktop = desktop
  vi.mocked(request).mockReset()
})
afterEach(() => {
  delete window.desktop
})
const panel = (name: string) => screen.getByRole("heading", { name }).closest("[data-slot=card]") as HTMLElement

it("creates a backup in the chosen folder and lists what was left out", async () => {
  vi.mocked(request).mockResolvedValueOnce(summary).mockRejectedValueOnce(new Error("Finish or cancel the active execution"))
  render(<WorkspaceBackup />)
  const create = within(panel("Back up workspace"))
  expect(create.getByRole("button", { name: "Create backup" })).toBeDisabled()
  expect(create.queryByRole("button", { name: "Browse" })).toBeNull()
  fireEvent.change(create.getByLabelText("Backup destination"), { target: { value: "/backups" } })
  fireEvent.click(create.getByRole("button", { name: "Create backup" }))
  expect(await create.findByRole("status")).toHaveTextContent("Backup created at /backups/work-tracker-backup-1.")
  expect(request).toHaveBeenCalledWith("workspace-backup/create", { destination: "/backups" })
  expect(create.getByText(/Sign in again after restoring/)).toBeInTheDocument()
  fireEvent.click(create.getByRole("button", { name: "Create backup" }))
  expect(await create.findByRole("alert")).toHaveTextContent("Finish or cancel the active execution")
  expect(create.queryByRole("status")).toBeNull()
})

it("shows the manifest summary and waits for confirmation before restoring", async () => {
  vi.mocked(request).mockResolvedValueOnce(summary).mockResolvedValueOnce({ restored: summary, previous: "/home/backups/pre-restore-1" })
  render(<WorkspaceBackup />)
  const restore = within(panel("Restore workspace"))
  fireEvent.change(restore.getByLabelText("Backup folder"), { target: { value: summary.path } })
  fireEvent.click(restore.getByRole("button", { name: "Check backup" }))
  const details = within(await restore.findByLabelText("Backup summary"))
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith("workspace-backup/inspect", { path: summary.path })
  expect(details.getByText("v4")).toBeInTheDocument()
  expect(details.getByText("Jobs").nextSibling).toHaveTextContent("3")
  expect(details.getByText("PDFs").nextSibling).toHaveTextContent("1")
  expect(details.queryByText("Recruiters")).toBeNull()
  expect(details.getByText("/home/browsers")).toBeInTheDocument()
  fireEvent.click(restore.getByRole("button", { name: "Restore this backup" }))
  expect(await restore.findByRole("status")).toHaveTextContent("The previous workspace was kept at /home/backups/pre-restore-1.")
  expect(request).toHaveBeenLastCalledWith("workspace-backup/restore", { path: summary.path, fingerprint: summary.fingerprint })
  expect(restore.queryByLabelText("Backup summary")).toBeNull()
})

it("reports a failed restore without claiming success and lets the user cancel", async () => {
  vi.mocked(request)
    .mockResolvedValueOnce({ ...summary, excluded: [] })
    .mockRejectedValueOnce(new Error("Restore failed and your previous workspace was kept: disk full"))
    .mockRejectedValueOnce(new Error("The backup is damaged"))
  render(<WorkspaceBackup />)
  const restore = within(panel("Restore workspace"))
  fireEvent.change(restore.getByLabelText("Backup folder"), { target: { value: "/b" } })
  fireEvent.click(restore.getByRole("button", { name: "Check backup" }))
  await restore.findByLabelText("Backup summary")
  expect(restore.queryByText("Not included")).toBeNull()
  fireEvent.click(restore.getByRole("button", { name: "Restore this backup" }))
  expect(await restore.findByRole("alert")).toHaveTextContent("previous workspace was kept: disk full")
  expect(restore.queryByRole("status")).toBeNull()
  fireEvent.click(restore.getByRole("button", { name: "Cancel" }))
  expect(restore.queryByLabelText("Backup summary")).toBeNull()
  expect(restore.queryByRole("alert")).toBeNull()
  fireEvent.click(restore.getByRole("button", { name: "Check backup" }))
  expect(await restore.findByRole("alert")).toHaveTextContent("The backup is damaged")
  expect(restore.queryByRole("button", { name: "Restore this backup" })).toBeNull()
})

it("discards a reviewed summary when another folder is typed", async () => {
  vi.mocked(request).mockResolvedValueOnce(summary)
  render(<WorkspaceBackup />)
  const restore = within(panel("Restore workspace"))
  fireEvent.change(restore.getByLabelText("Backup folder"), { target: { value: "/b" } })
  fireEvent.click(restore.getByRole("button", { name: "Check backup" }))
  await restore.findByLabelText("Backup summary")
  fireEvent.change(restore.getByLabelText("Backup folder"), { target: { value: "/other" } })
  expect(restore.queryByLabelText("Backup summary")).toBeNull()
})
