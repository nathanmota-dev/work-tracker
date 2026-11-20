import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppUpdates } from "@/components/app-updates"
import type { UpdateState } from "@/types/updates"

let state: UpdateState
let send: (next: UpdateState) => void
const check = vi.fn()
const download = vi.fn()
const install = vi.fn()
const openExternal = vi.fn()
const release = { version: "0.0.2", releaseDate: "2026-10-20T00:00:00Z", notes: "Better **updates**", url: "https://github.com/nathanmota-dev/work-tracker/releases/tag/v0.0.2" }
beforeEach(() => {
  vi.clearAllMocks()
  state = { status: "idle", installedVersion: "0.0.1", format: "AppImage", lastAttempt: null, lastSuccess: null, release: null, progress: null, error: null, retryAction: "check" }
  check.mockImplementation(async () => ({ ...state, status: "available", release }))
  download.mockImplementation(async () => ({ ...state, status: "ready", release, progress: 100 }))
  install.mockImplementation(async () => ({ ...state, status: "installing", release }))
  window.desktop = { getVersion: async () => "0.0.1", openExternal,
    updates: { getState: async () => state, onState: (callback: (next: UpdateState) => void) => { send = callback; return () => {} }, check, download, install } } as unknown as typeof window.desktop
})
afterEach(() => { delete window.desktop })

describe("Updates panel", () => {
  it("shows the version, discovers an update and requires an explicit download", async () => {
    render(<AppUpdates />)
    expect(await screen.findByText("0.0.1")).toBeInTheDocument()
    expect(screen.getByText("Never")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(await screen.findByText("0.0.2")).toBeInTheDocument()
    expect(screen.getByText("updates")).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("link", { name: "View release on GitHub" }))
    expect(openExternal).toHaveBeenCalledWith(release.url)
    fireEvent.click(screen.getByRole("button", { name: "Download update" }))
    expect(await screen.findByRole("button", { name: "Restart and install" })).toBeInTheDocument()
    expect(install).not.toHaveBeenCalled()
  })

  it("confirms before restarting and can cancel", async () => {
    state = { ...state, status: "ready", release }
    render(<AppUpdates />)
    fireEvent.click(await screen.findByRole("button", { name: "Restart and install" }))
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Restart and install" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Restart and install")!)
    expect(install).toHaveBeenCalledOnce()
  })

  it("follows pushed state: progress, errors and the unavailable install", async () => {
    render(<AppUpdates />)
    await screen.findByText("0.0.1")
    act(() => send({ ...state, status: "downloading", release, progress: 42.4 }))
    expect(screen.getByText("42%")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled()
    act(() => send({ ...state, status: "error", error: "integrity", retryAction: "download", release }))
    expect(screen.getByRole("alert")).toHaveTextContent("failed verification")
    expect(screen.getByRole("button", { name: "Download update" })).toBeEnabled()
    act(() => send({ ...state, status: "unavailable", format: null }))
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeDisabled()
    expect(screen.getByRole("status")).toHaveTextContent("only available in the AppImage")
  })

  it("surfaces a failed action as a network error", async () => {
    check.mockRejectedValue(new Error("offline"))
    render(<AppUpdates />)
    fireEvent.click(await screen.findByRole("button", { name: "Check for updates" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the update server")
  })

  it("is unavailable outside the desktop app", async () => {
    delete window.desktop
    render(<AppUpdates />)
    expect(await screen.findByRole("status")).toHaveTextContent("only available in the AppImage")
  })
})
