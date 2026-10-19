import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron"
import { registerApiBridge, connectApiBridge, closeApiBridge, emitBackendState } from "./api-bridge"
import { BackendSupervisor, type BackendHandlers } from "./backend-supervisor"
import backendPath from "./backend-process?modulePath"

declare const __WORK_TRACKER_REPO_ROOT__: string

let quitting = false
let shutdownTimer: ReturnType<typeof setTimeout> | undefined

function createWindow() {
  const window = new BrowserWindow({
    title: "Work Tracker",
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const load = !app.isPackaged && rendererUrl
    ? window.loadURL(rendererUrl)
    : window.loadFile(join(__dirname, "../renderer/index.html"))

  void load.catch((error: unknown) => {
    if (quitting) return
    console.error("Não foi possível carregar a interface:", error)
    app.quit()
  })
}

/** Backend output of this session, kept next to the previous session's log. */
function openBackendLog() {
  const path = join(resolve(process.env.WORK_TRACKER_HOME ?? join(homedir(), ".work-tracker")), "logs", "backend.log")
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (existsSync(path)) renameSync(path, `${path}.previous`)
  } catch (error) {
    console.error("Não foi possível preparar o log do backend:", error)
  }
  const stream = createWriteStream(path, { flags: "a", mode: 0o600 })
  stream.on("error", (error) => console.error("Não foi possível gravar o log do backend:", error))
  return { path, write: (text: string | Buffer) => stream.write(text) }
}

const log = openBackendLog()
const backend = new BackendSupervisor({
  logPath: log.path,
  log: (line) => log.write(`[${new Date().toISOString()}] ${line}\n`),
  spawn: spawnBackend,
  onReady: (connection) => {
    connectApiBridge(connection)
    if (process.env.WORK_TRACKER_SMOKE === "1") app.quit()
  },
  onUnavailable: (message) => {
    console.error(message)
    closeApiBridge(`${message} Restart the backend to continue.`)
  },
  onState: emitBackendState,
  onStopped: () => {
    clearTimeout(shutdownTimer)
    if (quitting) app.quit()
  },
})

function spawnBackend(handlers: BackendHandlers) {
  const child = utilityProcess.fork(backendPath, [], {
    serviceName: "Work Tracker Backend",
    stdio: "pipe",
    env: { ...process.env,
      WORK_TRACKER_REPO_ROOT: process.env.WORK_TRACKER_REPO_ROOT ?? (app.isPackaged ? __WORK_TRACKER_REPO_ROOT__ : app.getAppPath()),
      WORK_TRACKER_RESOURCES: app.isPackaged ? join(process.resourcesPath, "work-tracker") : join(app.getAppPath(), "resources"),
      WORK_TRACKER_CLI: app.isPackaged ? join(process.resourcesPath, "work-tracker", "cli", "work-tracker.cjs") : join(app.getAppPath(), "out", "cli", "work-tracker.cjs"),
    },
  })
  child.stdout?.on("data", (chunk: Buffer) => { process.stdout.write(chunk); log.write(chunk) })
  child.stderr?.on("data", (chunk: Buffer) => { process.stderr.write(chunk); log.write(chunk) })
  child.on("message", (message) => {
    if (process.env.WORK_TRACKER_SMOKE === "1" &&
        (message?.type === "ready" || message?.type === "stopped")) {
      console.log(JSON.stringify({ type: message.type }))
    }
    handlers.message(message)
    if (message?.type === "failed" && process.env.WORK_TRACKER_SMOKE === "1") app.quit()
  })
  child.on("exit", handlers.exit)
  return child
}

void app.whenReady().then(() => {
  ipcMain.handle("app:get-version", () => app.getVersion())
  registerApiBridge(backend)
  backend.start()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("before-quit", (event) => {
  if (!backend.running) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  closeApiBridge()
  backend.stop()
  shutdownTimer = setTimeout(() => backend.kill(), 5000)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
