import { app, BrowserWindow, ipcMain, Notification } from "electron"
import { AppUpdates } from "./app-updates"
import { createUpdateDriver } from "./update-driver"
import { updateStore } from "./update-state"
import type { UpdateState } from "../../web/src/types/updates"

/** Only an AppImage can replace itself; dev runs and unpacked installs stay unavailable. */
export function installedFormat(): UpdateState["format"] {
  if (!app.isPackaged || process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) return null
  if (process.env.SNAP || process.env.FLATPAK_ID) return null
  return process.env.APPIMAGE ? "AppImage" : null
}

export function registerUpdates() {
  const format = installedFormat()
  const driver = format ? createUpdateDriver(app.getVersion(), {
    // The existing before-quit handler stops the backend before the relaunch takes effect.
    prepare() {},
    cancel() {},
    restart(executable) {
      app.relaunch({ ...(executable ? { execPath: executable } : {}), args: process.argv.slice(1) })
      app.quit()
    },
  }) : null
  const updates = new AppUpdates({
    installedVersion: app.getVersion(), format, driver, store: updateStore(app.getPath("userData")),
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("updates:state", state)
    },
    notify: (version) => {
      if (Notification.isSupported()) new Notification({ title: "Work Tracker update available", body: `Version ${version} is ready to download in Settings → Updates.` }).show()
    },
  })
  const handlers = {
    "updates:get-state": updates.getState,
    "updates:check": updates.check,
    "updates:download": updates.download,
    "updates:install": updates.install,
  }
  for (const [channel, action] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event) => {
      const sender = BrowserWindow.fromWebContents(event.sender)
      if (!sender || event.senderFrame !== event.sender.mainFrame) throw new Error("Untrusted update request")
      return action()
    })
  }
  app.once("will-quit", () => {
    updates.dispose()
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  })
  return updates
}
