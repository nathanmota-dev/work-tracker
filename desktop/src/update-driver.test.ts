import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("electron", () => ({}))
import { replaceAppImage, selectUpdate, verifyArtifact } from "./update-driver"
import { CHECK_INTERVAL, isNewStable, releaseUrl, updateStore } from "./update-state"

const directories: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), "work-tracker-updater-")); directories.push(path); return path }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { force: true, recursive: true }) })
const sha512 = createHash("sha512").update("new app").digest("base64")
const legacy = { path: "unused", sha512, releaseDate: "2026-10-20" }
const file = (name: string) => ({ url: `work-tracker-0.0.2-${name}`, sha512 })

describe("release validation", () => {
  it("checks every 12 hours", () => { expect(CHECK_INTERVAL).toBe(12 * 60 * 60 * 1000) })
  it.each([
    ["0.0.10", "0.0.9", true], ["0.0.2", "0.0.10", false], ["0.0.1", "0.0.1", false],
    ["2.0.0-beta.1", "0.0.1", false], ["invalid", "0.0.1", false], ["0.0.1+build.2", "0.0.1", false],
  ])("compares stable semantic versions %s > %s", (version, installed, expected) => {
    expect(isNewStable(version, installed)).toBe(expected)
  })
  it("filters a mixed feed to the AppImage of this architecture", () => {
    const info = { version: "0.0.2", files: [file("arm64.AppImage"), file("x86_64.AppImage"), file("x64.deb")] }
    expect(selectUpdate({ ...legacy, ...info }, "x64").files).toEqual([file("x86_64.AppImage")])
    expect(selectUpdate({ ...legacy, ...info }, "arm64").files).toEqual([file("arm64.AppImage")])
  })
  it.each([
    { version: "2.0.0-beta.1", files: [file("x86_64.AppImage")] },
    { version: "2.0.0", files: [file("arm64.AppImage")] },
    { version: "2.0.0", files: [{ url: "work-tracker-x86_64.AppImage", sha512: "bad" }] },
    { version: "2.0.0", files: [file("x64.deb")] },
    { version: "nope", files: [file("x86_64.AppImage")] },
  ])("rejects invalid or incompatible metadata", (info) => {
    expect(() => selectUpdate({ ...legacy, ...info }, "x64")).toThrow("metadata")
  })
  it("restores persisted history and ignores corrupt state", () => {
    const files = new Map<string, string>()
    vi.mocked(fs.readFileSync).mockImplementation(((path: string) => {
      if (!files.has(path)) throw new Error("ENOENT")
      return files.get(path)
    }) as never)
    vi.mocked(fs.writeFileSync).mockImplementation(((path: string, data: string) => { files.set(path, data) }) as never)
    vi.spyOn(fs, "renameSync").mockImplementation(((from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from) }) as never)
    const store = updateStore("/data")
    expect(store.load().lastSuccess).toBeNull()
    const saved = { ...store.load(), lastAttempt: Date.now() - 30, lastSuccess: Date.now() - 30, lastNotified: "0.0.2", nextCheck: Date.now() + 5000,
      release: { version: "0.0.2", notes: "Notes", releaseDate: null, url: releaseUrl("0.0.2") } }
    store.save(saved)
    expect(store.load()).toEqual(saved)
    files.set("/data/updates.json", "broken")
    expect(store.load().nextCheck).toBe(0)
  })
})

describe("artifact integrity and atomic AppImage replacement", () => {
  it("verifies hashes and preserves the stable installed filename", async () => {
    const path = await directory()
    const source = join(path, "download.AppImage")
    const installed = join(path, "work-tracker.AppImage")
    await writeFile(source, "new app")
    await writeFile(installed, "old app")
    await verifyArtifact(source, sha512)
    await replaceAppImage(source, installed, sha512)
    expect(await readFile(installed, "utf8")).toBe("new app")
  })
  it("preserves the old app on checksum failure", async () => {
    const path = await directory()
    const source = join(path, "download.AppImage")
    const installed = join(path, "work-tracker.AppImage")
    await writeFile(source, "corrupted")
    await writeFile(installed, "old app")
    await expect(replaceAppImage(source, installed, sha512)).rejects.toThrow("integrity")
    expect(await readFile(installed, "utf8")).toBe("old app")
  })
})
