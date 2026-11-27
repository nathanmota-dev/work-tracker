import { BrowserWindow, ipcMain, shell, dialog } from "electron"
import { writeFile } from "node:fs/promises"
import WebSocket from "ws"
import type { BackendConnection, BackendState } from "./backend-supervisor"

const reads = new Set([
  "integrations",
  "integrations/status",
  "onboarding/status",
  "overview",
  "recruiters",
  "recruiters/due",
  "outreach",
  "jobs",
  "metrics",
  "interviews",
  "applications",
  "applications/summary",
  "application-board",
  "answers",
  "answers/variants",
  "answers/catalog",
  "activity",
  "profile",
  "profile-snapshot",
  "acp/providers",
  "acp/permissions",
  "resume-sources",
  "preparation-batches",
  "interview-preps",
  "followups",
  "followups/candidates",
  "rankings",
  "rankings/candidates",
  "gates/profile",
  "profile-sources",
  "resume-variants",
  // A saved resume's page also opens archived ones.
  "resume-variants?archived=true",
  "ats/best",
])
const writes = new Set([
  "integrations",
  "integrations/test",
  "integrations/install",
  "onboarding/preferences",
  "browser/login",
  "jobs/import",
  "jobs/create",
  "jobs/update",
  "jobs/save-search",
  "jobs/shortlist",
  "jobs/archive",
  "jobs/restore",
  "jobs/delete",
  "interviews/create",
  "interviews/update",
  "interviews/delete",
  "answer",
  "answer/delete",
  "acp/run",
  "acp/permissions/answer",
  "acp/permissions/rule",
  "resume-sources",
  "resume-sources/preview",
  "application-preparation/details",
  "application-preparation/generate",
  "application-preparation/description",
  "application-preparation/cancel",
  "application-preparation/fill",
  "application-preparation/approve",
  "application-preparation/retry",
  "application-preparation/submitted",
  "application-preparation/use-variant",
  "application-preparation/use-base",
  "resume-variants/generate",
  "resume-variants/regenerate",
  "resume-variants/update",
  "resume-variants/archive",
  "resume-variants/cancel",
  "resume-variants/import",
  "preparation-batches/preview",
  "preparation-batches/create",
  "preparation-batches/add",
  "preparation-batches/pause",
  "preparation-batches/resume",
  "preparation-batches/cancel",
  "preparation-batches/retry",
  "preparation-batches/adjust",
  "acp/cancel",
  "recruiters/sync",
  "search/jobs",
  "search/people",
  "search/job-details",
  "application-board/create",
  "application-board/update",
  "application-board/portal-link",
  "application-board/move",
  "application-board/archive",
  "application-board/reopen",
  "application-board/submit",
  "application-board/details",
  "application-board/link/options",
  "application-board/link",
  "application-board/review",
  "application-board/review/resolve",
  "application-board/review/reconcile",
  "application-board/stages/save",
  "application-board/stages/reorder",
  "application-board/stages/set-archived",
  "application-board/quiet/resolve",
  "followups/sent",
  "followups/discard",
  "gates/languages",
  "gates/eligibility",
  "profile-sources/import",
  "profile-sources/choice",
  "profile-sources/upload",
  "company-research/invalidate",
  "workspace-backup/create",
  "workspace-backup/inspect",
  "workspace-backup/restore",
])
let connection: BackendConnection | undefined
let socket: WebSocket | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let live = false
let unavailable: string | undefined
function emit(event: unknown) {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("api:event", event)
}
async function pdfBuffer(artifactId: string): Promise<ArrayBuffer> {
  if (typeof artifactId !== "string" || !connection) throw new Error("Backend unavailable.")
  const url = new URL("/api/application-preparation/pdf", connection.address)
  url.searchParams.set("token", connection.token)
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artifactId }) })
  if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "PDF unavailable.")
  return response.arrayBuffer()
}
export type BackendControl = { state(): BackendState; restart(): boolean }
export function emitBackendState(state: BackendState) {
  emit({ type: "backend", state })
}
export function registerApiBridge(backend: BackendControl) {
  ipcMain.handle("backend:status", () => backend.state())
  ipcMain.handle("backend:restart", () => backend.restart())
  ipcMain.handle("api:pdf", (_event, artifactId: string) => pdfBuffer(artifactId))
  ipcMain.handle("api:save-pdf", async (_event, artifactId: string) => {
    const bytes = await pdfBuffer(artifactId)
    const selected = await dialog.showSaveDialog({ defaultPath: "resume.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] })
    if (!selected.canceled && selected.filePath) await writeFile(selected.filePath, Buffer.from(bytes))
    return !selected.canceled
  })
  ipcMain.handle("app:choose-source", async (_event, kind: string) => {
    if (!["folder", "data", "pdf"].includes(kind)) throw new Error("Unknown source type")
    const filters = kind === "data" ? [{ name: "Resume data", extensions: ["json"] }] : kind === "pdf" ? [{ name: "PDF", extensions: ["pdf"] }] : undefined
    const selected = await dialog.showOpenDialog({ properties: kind === "folder" ? ["openDirectory"] : ["openFile"], ...(filters ? { filters } : {}) })
    return selected.canceled ? null : selected.filePaths[0] ?? null
  })
  ipcMain.handle("api:status", () => live)
  ipcMain.handle(
    "api:request",
    async (_event, path: string, body?: unknown) => {
      const batchReview = body === undefined && /^preparation-batches\/review\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path)
      const applicationPacks = body === undefined && /^interview-preps\/[1-9]\d*$/.test(path)
      const quietScan = body === undefined && /^application-board\/quiet(\?days=[1-9]\d{0,3})?$/.test(path)
      const followups = body === undefined && /^followups(\?application_id=[1-9]\d*|\/candidates\?days=[1-9]\d{0,3})$/.test(path)
      const companyResearch = body === undefined && /^company-research\?company=[^&#]{1,600}$/.test(path)
      const rankings = body === undefined && /^rankings\/candidates\?(all=true(&job_ids=[1-9]\d*(,[1-9]\d*)*)?|job_ids=[1-9]\d*(,[1-9]\d*)*)$/.test(path)
      const jobGate = body === undefined && /^(gates|ats)\/jobs\/[1-9]\d*$/.test(path)
      if (!(body === undefined ? reads : writes).has(path) && !batchReview && !applicationPacks && !quietScan && !companyResearch && !followups && !rankings && !jobGate)
        throw new Error("Unsupported API request")
      if (!connection)
        throw new Error(unavailable ?? "Backend is starting. Please retry in a moment.")
      const url = new URL(`/api/${path}`, connection.address)
      url.searchParams.set("token", connection.token)
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(["acp/providers", "resume-sources/preview"].includes(path) || path.startsWith("workspace-backup/") ? 120000 : 60000),
      })
      const text = await response.text()
      if (!response.ok) {
        let message = text
        try {
          message = JSON.parse(text).error ?? text
        } catch {
          /* plain response */
        }
        throw new Error(message || `Request failed (${response.status})`)
      }
      return JSON.parse(text)
    },
  )
  ipcMain.handle("app:open-external", async (_event, value: string) => {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol))
      throw new Error("Only web links can be opened")
    await shell.openExternal(url.toString())
  })
}
/** Connect to a backend process; sockets of a previous connection can no longer emit or reconnect. */
export function connectApiBridge(value: BackendConnection) {
  closeApiBridge()
  connection = value
  const connect = () => {
    if (connection !== value) return
    const url = new URL("/ws", value.address)
    url.protocol = "ws:"
    url.searchParams.set("token", value.token)
    const current = new WebSocket(url)
    socket = current
    current.on("open", () => {
      if (socket !== current) return
      setLive(true)
      emit({ type: "changed" })
    })
    current.on("message", (data) => {
      if (socket !== current) return
      try {
        emit(JSON.parse(data.toString()))
      } catch {
        /* invalid frame */
      }
    })
    current.on("error", () => current.close())
    current.on("close", () => {
      if (socket !== current) return
      socket = undefined
      setLive(false)
      if (connection === value) retry = setTimeout(connect, 2000)
    })
  }
  connect()
}
function setLive(value: boolean) {
  if (live === value) return
  live = value
  emit({ type: "connection", live: value })
}
/** Stop using the backend; requests fail with `reason` until the next connection. */
export function closeApiBridge(reason?: string) {
  unavailable = reason
  connection = undefined
  clearTimeout(retry)
  const current = socket
  socket = undefined
  current?.close()
  setLive(false)
}
