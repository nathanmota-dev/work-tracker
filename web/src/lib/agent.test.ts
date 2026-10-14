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
    readPdf: vi.fn(),
    savePdf: vi.fn(),
    chooseSource: vi.fn(),
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
  it("opens tailoring in Apply without starting an agent", () => {
    const view = renderHook(useAgent)
    act(() => prepareSkill("resume-tailor", { jobIds: "12" }))
    expect(view.result.current.draft).toBeNull()
    expect(window.location.hash).toBe("#/apply?jobId=12")
    expect(request).not.toHaveBeenCalled()
  })
  it("merges tool updates by ID while preserving omitted fields and streamed output snapshots", () => {
    const view = renderHook(useAgent)
    const event = (update: Record<string, unknown>) => publish({ type: "acp-update", update: { update } })
    act(() => {
      event({ sessionUpdate: "tool_call", toolCallId: "cmd-1", title: "bash", kind: "execute", status: "pending" })
      event({ sessionUpdate: "tool_call_update", toolCallId: "cmd-1", title: "ls /workspace", status: "in_progress" })
      event({ sessionUpdate: "tool_call_update", toolCallId: "cmd-1", content: [{ content: { type: "text", text: "one" } }] })
      event({ sessionUpdate: "tool_call_update", toolCallId: "cmd-1", status: "completed", content: [{ content: { type: "text", text: "one\ntwo" } }] })
    })
    expect(view.result.current.messages).toHaveLength(1)
    expect(view.result.current.messages[0]?.tool).toMatchObject({ title: "ls /workspace", kind: "execute", status: "completed", output: "one\ntwo" })
  })
  it("handles out-of-order updates and isolates reused tool IDs across runs", async () => {
    const view = renderHook(useAgent)
    const event = () => publish({ type: "acp-update", update: { sessionUpdate: "tool_call_update", toolCallId: "same", status: "completed" } })
    act(event)
    await act(async () => { await runAgent("opencode", "job-scout", {}) })
    act(event)
    expect(view.result.current.messages.filter(m => m.tool)).toHaveLength(2)
  })
  it("shows pending login without ending the run and restores status on successful retry", async () => {
    const view = renderHook(useAgent)
    await act(async () => { await runAgent("opencode", "profile-optimizer", {}) })
    act(() => publish({ type: "acp-update", update: { sessionUpdate: "tool_call", toolCallId: "login", status: "failed", content: [{ content: { type: "text", text: "A LinkedIn login window is open and login is still in progress. This is not a failure." } }] } }))
    expect(view.result.current.status).toBe("Waiting for sign-in")
    expect(view.result.current.running).toBe(true)
    act(() => publish({ type: "acp-update", update: { sessionUpdate: "tool_call", toolCallId: "todos", title: "5 todos", status: "completed" } }))
    expect(view.result.current.status).toBe("Waiting for sign-in")
    act(() => publish({ type: "acp-update", update: { sessionUpdate: "tool_call_update", toolCallId: "login", status: "completed" } }))
    expect(view.result.current.status).toBe("running")
  })
  it("allows retry when the backend retains a session for sign-in and lets the user cancel that wait", async () => {
    const view = renderHook(useAgent)
    await act(async () => { await runAgent("opencode", "profile-optimizer", {}) })
    act(() => publish({ type: "acp-status", status: "waiting_for_sign_in" }))
    expect(view.result.current.status).toBe("Waiting for sign-in")
    expect(view.result.current.running).toBe(false)
    act(clearAgent)
    expect(view.result.current.status).toBe("Waiting for sign-in")
    await act(async () => { await runAgent("opencode", "profile-optimizer", {}) })
    expect(request.mock.calls.filter(call => call[0] === "acp/run")).toHaveLength(2)
    request.mockImplementation(async path => {
      if (path === "acp/cancel") publish({ type: "acp-status", status: "cancelled" })
      return { ok: true }
    })
    await act(cancelAgent)
    expect(view.result.current.status).toBe("cancelled")
  })
  it("marks unfinished commands interrupted when ACP stops instead of leaving them running", async () => {
    const view = renderHook(useAgent)
    await act(async () => { await runAgent("opencode", "profile-optimizer", {}) })
    act(() => {
      publish({ type: "acp-update", update: { sessionUpdate: "tool_call", toolCallId: "sleep", title: "sleep 30", kind: "execute", status: "in_progress" } })
      publish({ type: "acp-error", message: "ACP session stopped" })
    })
    expect(view.result.current.messages.find(message => message.tool)?.tool?.status).toBe("interrupted")
    expect(view.result.current.running).toBe(false)
  })
})
