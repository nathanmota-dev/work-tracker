import { createHash } from "node:crypto"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createUpdateDriver } from "./update-driver"

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events")
  const state = { info: {} as unknown, paths: [] as string[] }
  class Updater extends EventEmitter {
    async getUpdateInfoAndProvider() { return { info: state.info } }
    async checkForUpdates() { return { updateInfo: (await this.getUpdateInfoAndProvider()).info } }
    async downloadUpdate() { return state.paths }
  }
  return { state, Updater }
})
vi.mock("electron-updater", () => ({ AppImageUpdater: mocks.Updater }))
vi.mock("electron", () => ({}))

let directory: string
const lifecycle = { prepare: vi.fn(), cancel: vi.fn(), restart: vi.fn() }
const drivers: ReturnType<typeof createUpdateDriver>[] = []
async function create() {
  const artifact = join(directory, "download.AppImage")
  await writeFile(artifact, "new app")
  const sha512 = createHash("sha512").update("new app").digest("base64")
  mocks.state.paths = [artifact]
  mocks.state.info = { version: "0.0.2", path: "unused", sha512, releaseDate: "2026-10-21",
    releaseNotes: [{ version: "0.0.2", note: "Fixes" }], files: [{ url: "work-tracker-0.0.2-x86_64.AppImage", sha512 }] }
  const driver = createUpdateDriver("0.0.1", lifecycle)
  drivers.push(driver)
  return { driver, artifact }
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal("process", { ...process, platform: "linux", arch: "x64" })
  directory = await mkdtemp(join(tmpdir(), "work-tracker-linux-update-"))
})
afterEach(async () => {
  for (const driver of drivers.splice(0)) driver.dispose()
  await chmod(directory, 0o700)
  await rm(directory, { force: true, recursive: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("Linux AppImage updater", () => {
  it("reports a newer stable release with its notes and none when current", async () => {
    const { driver } = await create()
    expect(await driver.check()).toMatchObject({ version: "0.0.2", notes: "Fixes", releaseDate: "2026-10-21" })
    mocks.state.info = { ...(mocks.state.info as object), version: "0.0.1" }
    expect(await driver.check()).toBeNull()
  })

  it("downloads, verifies and atomically replaces the running AppImage, then restarts it", async () => {
    const installed = join(directory, "work-tracker.AppImage")
    await writeFile(installed, "old app", { mode: 0o755 })
    vi.stubEnv("APPIMAGE", installed)
    const { driver } = await create()
    const progress = vi.fn()
    await driver.check()
    await driver.download("0.0.2", progress)
    expect(await readFile(installed, "utf8")).toBe("old app")
    await driver.install()
    expect(await readFile(installed, "utf8")).toBe("new app")
    expect(lifecycle.prepare).toHaveBeenCalledOnce()
    expect(lifecycle.restart).toHaveBeenCalledExactlyOnceWith(installed)
  })

  it("refuses a download of a version other than the checked one", async () => {
    vi.stubEnv("APPIMAGE", join(directory, "work-tracker.AppImage"))
    const { driver } = await create()
    await driver.check()
    await expect(driver.download("9.9.9", vi.fn())).rejects.toMatchObject({ kind: "metadata" })
  })

  it("does not install a corrupted download", async () => {
    const installed = join(directory, "work-tracker.AppImage")
    await writeFile(installed, "old app")
    vi.stubEnv("APPIMAGE", installed)
    const { driver, artifact } = await create()
    await driver.check()
    await driver.download("0.0.2", vi.fn())
    await writeFile(artifact, "corrupted")
    await expect(driver.install()).rejects.toMatchObject({ kind: "integrity" })
    expect(await readFile(installed, "utf8")).toBe("old app")
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it("preserves an unwritable AppImage and permits download after permissions are restored", async () => {
    const installed = join(directory, "work-tracker.AppImage")
    await writeFile(installed, "old app", { mode: 0o555 })
    vi.stubEnv("APPIMAGE", installed)
    const { driver } = await create()
    await driver.check()
    await expect(driver.download("0.0.2", vi.fn())).rejects.toThrow()
    expect(await readFile(installed, "utf8")).toBe("old app")
    await chmod(installed, 0o755)
    await driver.download("0.0.2", vi.fn())
    await driver.install()
    expect(await readFile(installed, "utf8")).toBe("new app")
  })

  it("needs the APPIMAGE path to download and never creates a driver outside Linux", async () => {
    const { driver } = await create()
    await driver.check()
    await expect(driver.download("0.0.2", vi.fn())).rejects.toMatchObject({ kind: "permission" })
    vi.stubGlobal("process", { ...process, platform: "win32" })
    expect(() => createUpdateDriver("0.0.1", lifecycle)).toThrow("metadata")
  })
})
