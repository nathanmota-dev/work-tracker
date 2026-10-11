import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  cancelAgent,
  clearAgent,
  prepareSkill,
  runAgent,
  useAgent,
} from "./agent"
import { publish } from "./api"
const request = vi.fn()
beforeEach(() => {
  request
    .mockReset()
    .mockImplementation(async (path: string) =>
      path === "answers" ? [] : { ok: true },
    )
  window.desktop = {
    request,
    connectionStatus: async () => true,
    getVersion: async () => "1",
    openExternal: vi.fn(),
    onEvent: () => () => {},
  }
  publish({ type: "acp-status", status: "done" })
  clearAgent()
})
describe("agent session", () => {
  it("assembles streamed message chunks and keeps output across page remounts", async () => {
    const first = renderHook(useAgent)
    await act(async () => {
      await runAgent("opencode", "job-scout", { query: "React" })
    })
    expect(request).toHaveBeenCalledWith("acp/run", {
      provider: "opencode",
      skill: "job-scout",
      params: { query: "React" },
    })
    act(() => {
      publish({
        type: "acp-update",
        update: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello " },
          },
        },
      })
      publish({
        type: "acp-update",
        update: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "world" },
          },
        },
      })
    })
    expect(first.result.current.messages.at(-1)?.text).toBe("Hello world")
    first.unmount()
    const second = renderHook(useAgent)
    expect(second.result.current.running).toBe(true)
    expect(second.result.current.messages.at(-1)?.text).toBe("Hello world")
    act(() => publish({ type: "acp-status", status: "done" }))
    expect(second.result.current.running).toBe(false)
  })
  it("blocks duplicate runs and sends cancel through the API", async () => {
    renderHook(useAgent)
    await act(async () => {
      await runAgent("opencode", "job-scout", {})
      await runAgent("opencode", "job-scout", {})
      await cancelAgent()
    })
    expect(request.mock.calls.map((c) => c[0])).toEqual([
      "answers",
      "acp/run",
      "acp/cancel",
    ])
  })
  it("recovers from run request failures", async () => {
    request.mockImplementation(async (path: string) => { if (path === "answers") return []; throw new Error("Offline") })
    const view = renderHook(useAgent)
    await act(async () => {
      await runAgent("opencode", "job-scout", {})
    })
    expect(view.result.current.running).toBe(false)
    expect(view.result.current.messages.at(-1)?.text).toBe("Offline")
  })
  it("loads the latest saved identity before starting a skill", async () => {
    request.mockImplementation(async (path: string) => path === "answers" ? [
      { key: "first_name", value: "Ana" }, { key: "last_name", value: "Silva" },
      { key: "linkedin_url", value: "https://www.linkedin.com/in/ana-silva/" },
    ] : { ok: true })
    renderHook(useAgent)
    await act(async () => { await runAgent("opencode", "profile-optimizer", {}) })
    expect(request).toHaveBeenCalledWith("acp/run", expect.objectContaining({ params: expect.objectContaining({ username: "ana-silva", displayName: "Ana Silva" }) }))
  })
  it("prefills launch without starting an agent", () => {
    const view = renderHook(useAgent)
    act(() => prepareSkill("resume-tailor", { jobIds: "12" }))
    expect(view.result.current.draft).toEqual({
      skill: "resume-tailor",
      params: { jobIds: "12" },
    })
    expect(request).not.toHaveBeenCalled()
  })
})
