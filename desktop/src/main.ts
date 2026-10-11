import { join } from "node:path"
import { app, BrowserWindow, ipcMain, utilityProcess } from "electron"
import type { UtilityProcess } from "electron"
import { registerApiBridge, connectApiBridge, closeApiBridge } from "./api-bridge"
import backendPath from "./backend-process?modulePath"

let backend: UtilityProcess | null = null
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
    console.error("Não foi possível carregar a interface:", error)
    app.quit()
  })
}

void app.whenReady().then(() => {
  ipcMain.handle("app:get-version", () => app.getVersion())
  registerApiBridge()

  backend = utilityProcess.fork(backendPath, [], {
    serviceName: "Work Tracker Backend",
    env: { ...process.env,
      WORK_TRACKER_RESOURCES: app.isPackaged ? join(process.resourcesPath, "work-tracker") : join(app.getAppPath(), "resources"),
      WORK_TRACKER_CLI: app.isPackaged ? join(process.resourcesPath, "work-tracker", "cli", "work-tracker.cjs") : join(app.getAppPath(), "out", "cli", "work-tracker.cjs"),
    },
  })
  backend.on("message", (message) => {
    if (message?.type === "ready") connectApiBridge(message)
    if (message?.type === "failed") app.quit()
    if (message?.type === "ready" && process.env.WORK_TRACKER_SMOKE === "1") app.quit()
  })
  backend.on("exit", (code) => {
    backend = null
    clearTimeout(shutdownTimer)
    if (quitting) app.quit()
    if (code !== 0) console.error(`O backend encerrou com código ${code}.`)
  })

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("before-quit", (event) => {
  if (!backend) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  closeApiBridge()
  backend.postMessage({ type: "shutdown" })
  shutdownTimer = setTimeout(() => { backend?.kill() }, 5000)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
