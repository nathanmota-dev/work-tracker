import { BrowserWindow, ipcMain, shell } from "electron"
import WebSocket from "ws"

const reads = new Set([
  "overview",
  "recruiters",
  "recruiters/due",
  "outreach",
  "jobs",
  "metrics",
  "interviews",
  "applications",
  "application-board",
  "answers",
  "activity",
  "profile",
  "profile-snapshot",
  "acp/providers",
])
const writes = new Set([
  "jobs/archive",
  "jobs/restore",
  "jobs/delete",
  "answer",
  "acp/run",
  "acp/cancel",
  "recruiters/sync",
  "search/jobs",
  "search/people",
  "search/job-details",
  "application-board/create",
  "application-board/update",
  "application-board/move",
  "application-board/archive",
  "application-board/reopen",
  "application-board/details",
  "application-board/stages/save",
  "application-board/stages/reorder",
  "application-board/stages/set-archived",
])
let connection: { address: string; token: string } | undefined
let socket: WebSocket | undefined
let retry: ReturnType<typeof setTimeout> | undefined
let live = false
function emit(event: unknown) {
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("api:event", event)
}
export function registerApiBridge() {
  ipcMain.handle("api:status", () => live)
  ipcMain.handle(
    "api:request",
    async (_event, path: string, body?: unknown) => {
      if (!(body === undefined ? reads : writes).has(path))
        throw new Error("Unsupported API request")
      if (!connection)
        throw new Error("Backend is starting. Please retry in a moment.")
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
        signal: AbortSignal.timeout(path === "acp/providers" ? 120000 : 60000),
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
export function connectApiBridge(value: { address: string; token: string }) {
  connection = value
  const connect = () => {
    if (!connection) return
    const url = new URL("/ws", connection.address)
    url.protocol = "ws:"
    url.searchParams.set("token", connection.token)
    socket = new WebSocket(url)
    socket.on("open", () => {
      live = true
      emit({ type: "connection", live: true })
      emit({ type: "changed" })
    })
    socket.on("message", (data) => {
      try {
        emit(JSON.parse(data.toString()))
      } catch {
        /* invalid frame */
      }
    })
    socket.on("error", () => socket?.close())
    socket.on("close", () => {
      live = false
      emit({ type: "connection", live: false })
      if (connection) retry = setTimeout(connect, 2000)
    })
  }
  connect()
}
export function closeApiBridge() {
  connection = undefined
  clearTimeout(retry)
  socket?.close()
  live = false
}
