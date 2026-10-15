import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { openApply, preparationMessages, usePreparation } from "./preparation"
import { request, subscribe, type ApiEvent } from "./api"
import { deferred } from "@/test/doubles"
vi.mock("./api", () => ({ request: vi.fn(), subscribe: vi.fn() }))
let listener: (event: ApiEvent) => void
const stop = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(request).mockReset().mockResolvedValue({ busy: false })
  vi.mocked(subscribe).mockImplementation((fn) => {
    listener = fn
    return stop
  })
  stop.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  window.location.hash = ""
})
const flush = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}
it("opens Apply with encoded optional identifiers", () => {
  openApply()
  expect(window.location.hash).toBe("#/apply")
  openApply(7, 3, "run & one")
  expect(window.location.hash).toBe(
    "#/apply?jobId=7&applicationId=3&runId=run+%26+one",
  )
  openApply(0, -1)
  expect(window.location.hash).toBe("#/apply")
})
it("merges streamed chunks, nested updates and tool snapshots without losing omitted fields", () => {
  const update = (value: Record<string, unknown>) => ({
    type: "acp-update",
    update: value,
  })
  const messages = preparationMessages([
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello " },
    }),
    {
      type: "acp-update",
      update: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "world" },
        },
      },
    },
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "x",
      status: "in_progress",
    }),
    update({
      sessionUpdate: "tool_call",
      toolCallId: "x",
      title: "Compile",
      kind: "execute",
      rawInput: { cmd: "latex" },
      content: [{ content: { type: "text", text: "log" } }],
    }),
    update({
      sessionUpdate: "tool_call_update",
      toolCallId: "x",
      status: "completed",
    }),
    { type: "acp-log", line: "diagnostic" },
    { type: "acp-error", message: "failure" },
    { type: "irrelevant" },
  ])
  expect(messages).toHaveLength(4)
  expect(messages[0]?.text).toBe("Hello world")
  expect(messages[1]?.tool).toEqual({
    title: "Compile",
    kind: "execute",
    status: "completed",
    output: "log",
    input: { cmd: "latex" },
  })
  expect(messages[2]).toMatchObject({ diagnostic: true, text: "diagnostic" })
  expect(messages[3]?.text).toBe("failure")
})
it.each(["completed", "failed", "cancelled", "interrupted"])(
  "marks unfinished tools interrupted for %s",
  (status) => {
    const messages = preparationMessages(
      [
        {
          type: "acp-update",
          update: { sessionUpdate: "tool_call", toolCallId: "x" },
        },
      ],
      status,
    )
    expect(messages[0]?.tool?.status).toBe("interrupted")
  },
)
it("does not fetch without a job and clears loading when a pending selection is removed", async () => {
  const pending = deferred<unknown>()
  vi.mocked(request).mockReturnValue(pending.promise)
  const hook = renderHook(
    ({ jobId }: { jobId?: number }) => usePreparation(jobId),
    { initialProps: { jobId: undefined as number | undefined } },
  )
  expect(request).not.toHaveBeenCalled()
  hook.rerender({ jobId: 1 })
  expect(hook.result.current.loading).toBe(true)
  hook.rerender({ jobId: undefined })
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.data).toBeUndefined()
  await act(async () => pending.resolve({ busy: true }))
  expect(hook.result.current.data).toBeUndefined()
})
it("fetches selected identities, ignores stale responses and recovers after errors", async () => {
  const first = deferred<unknown>()
  vi.mocked(request)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ busy: false, runs: ["new"] })
  const hook = renderHook(
    ({ jobId, applicationId }) => usePreparation(jobId, applicationId),
    { initialProps: { jobId: 1, applicationId: 2 } },
  )
  hook.rerender({ jobId: 3, applicationId: 4 })
  await flush()
  await act(async () => first.resolve({ busy: true, runs: ["old"] }))
  expect(hook.result.current.data?.runs).toEqual(["new"])
  expect(request).toHaveBeenLastCalledWith("application-preparation/details", {
    jobId: 3,
    applicationId: 4,
  })
  vi.mocked(request).mockRejectedValueOnce(new Error("offline"))
  act(() => hook.result.current.refresh())
  await flush()
  expect(hook.result.current.error).toBe("offline")
  act(() => hook.result.current.refresh())
  await flush()
  expect(hook.result.current.error).toBe("")
})
it("debounces events, polls only while busy and removes timers/listeners", async () => {
  vi.mocked(request).mockResolvedValue({ busy: true })
  const hook = renderHook(() => usePreparation(1))
  await flush()
  vi.mocked(request).mockClear()
  act(() => {
    listener({ type: "other" })
    listener({ type: "changed" })
    listener({ type: "acp-status" })
    listener({ type: "connection" })
  })
  await act(async () => vi.advanceTimersByTimeAsync(249))
  expect(request).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(1))
  expect(request).toHaveBeenCalledOnce()
  await act(async () => vi.advanceTimersByTimeAsync(1250))
  expect(request).toHaveBeenCalledTimes(2)
  vi.mocked(request).mockResolvedValue({ busy: false })
  act(() => hook.result.current.refresh())
  await flush()
  const count = vi.mocked(request).mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(3000))
  expect(request).toHaveBeenCalledTimes(count)
  act(() => listener({ type: "changed" }))
  hook.unmount()
  expect(stop).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
