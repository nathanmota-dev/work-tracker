import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn(), createUpdateDriver: vi.fn(), show: vi.fn(), supported: vi.fn() }))
const app = Object.assign(new EventEmitter(), { isPackaged: true, getVersion: () => "0.0.1", getPath: () => "/data", relaunch: vi.fn(), quit: vi.fn() })
const sender = { mainFrame: {} }
const event = { sender, senderFrame: sender.mainFrame }
const window = { isDestroyed: () => false, webContents: { send: vi.fn() } }
class Notification { constructor(public options: unknown) {} show() { mocks.show(this.options) } static isSupported = mocks.supported }
vi.mock("electron", () => ({ app, Notification, ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler },
  BrowserWindow: { getAllWindows: () => [window], fromWebContents: (value: unknown) => value === sender ? window : null } }))
vi.mock("./update-driver", () => ({ createUpdateDriver: mocks.createUpdateDriver }))
vi.mock("./update-state", async (original) => ({
  ...await original<typeof import("./update-state")>(),
  updateStore: () => ({ load: () => ({ lastAttempt: null, lastSuccess: null, nextCheck: 0, failures: 0, lastNotified: null, release: null }), save: vi.fn() }),
}))
const driver = { check: vi.fn(), download: vi.fn(), install: vi.fn(), dispose: vi.fn() }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers()
  vi.stubGlobal("process", { ...process, platform: "linux", arch: "x64" })
  vi.stubEnv("APPIMAGE", "/stable/work-tracker.AppImage")
  app.isPackaged = true
  mocks.supported.mockReturnValue(true)
  mocks.createUpdateDriver.mockReturnValue(driver)
  driver.check.mockResolvedValue({ version: "0.0.2", notes: null, releaseDate: null, url: "https://github.com/nathanmota-dev/work-tracker/releases/tag/v0.0.2" })
})
afterEach(() => { app.emit("will-quit"); app.removeAllListeners(); vi.useRealTimers() })

describe("updater main wiring", () => {
  it("registers actions, validates senders, notifies and disposes handlers on quit", async () => {
    const { registerUpdates } = await import("./register-updates")
    registerUpdates()
    const handlers = Object.fromEntries(mocks.handle.mock.calls)
    expect(Object.keys(handlers)).toEqual(["updates:get-state", "updates:check", "updates:download", "updates:install"])
    expect(() => handlers["updates:install"]({ sender: {}, senderFrame: {} })).toThrow("Untrusted")
    expect(() => handlers["updates:check"]({ sender, senderFrame: {} })).toThrow("Untrusted")
    await handlers["updates:check"](event)
    expect(window.webContents.send).toHaveBeenCalledWith("updates:state", expect.objectContaining({ status: "available" }))
    expect(mocks.show).toHaveBeenCalledOnce()
    app.emit("will-quit")
    expect(mocks.removeHandler).toHaveBeenCalledTimes(4)
    expect(driver.dispose).toHaveBeenCalledOnce()
  })

  it("skips the notification when the desktop does not support it", async () => {
    mocks.supported.mockReturnValue(false)
    const { registerUpdates } = await import("./register-updates")
    registerUpdates()
    await Object.fromEntries(mocks.handle.mock.calls)["updates:check"](event)
    expect(mocks.show).not.toHaveBeenCalled()
  })

  it("relaunches the new AppImage after installing", async () => {
    const { registerUpdates } = await import("./register-updates")
    registerUpdates()
    const lifecycle = mocks.createUpdateDriver.mock.calls[0][1]
    lifecycle.prepare(); lifecycle.cancel()
    lifecycle.restart("/stable/work-tracker.AppImage")
    expect(app.relaunch).toHaveBeenCalledWith(expect.objectContaining({ execPath: "/stable/work-tracker.AppImage" }))
    expect(app.quit).toHaveBeenCalledOnce()
    lifecycle.restart()
    expect(app.relaunch).toHaveBeenLastCalledWith(expect.not.objectContaining({ execPath: expect.anything() }))
  })

  it.each([
    ["development", () => { app.isPackaged = false }],
    ["Windows", () => vi.stubGlobal("process", { ...process, platform: "win32", arch: "x64" })],
    ["unsupported CPU", () => vi.stubGlobal("process", { ...process, platform: "linux", arch: "ia32" })],
    ["Snap", () => vi.stubEnv("SNAP", "/snap/x")],
    ["Flatpak", () => vi.stubEnv("FLATPAK_ID", "dev.x")],
    ["an unpacked install", () => vi.stubEnv("APPIMAGE", "")],
  ])("stays unavailable in %s", async (_name, setup) => {
    setup()
    const { installedFormat, registerUpdates } = await import("./register-updates")
    expect(installedFormat()).toBeNull()
    expect(registerUpdates().getState().status).toBe("unavailable")
    expect(mocks.createUpdateDriver).not.toHaveBeenCalled()
  })

  it("detects an AppImage install", async () => {
    const { installedFormat } = await import("./register-updates")
    expect(installedFormat()).toBe("AppImage")
  })
})
