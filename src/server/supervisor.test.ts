import { describe, expect, it, vi } from "vitest"
import { BackendSupervisor, MAX_FAILURES, STABLE_MS, type BackendHandlers } from "./supervisor"

function harness() {
  const children: { handlers: BackendHandlers; postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }[] = []
  let time = 0
  const options = {
    logPath: "/workspace/logs/backend.log",
    log: vi.fn(),
    onReady: vi.fn(),
    onUnavailable: vi.fn(),
    onState: vi.fn(),
    onStopped: vi.fn(),
    now: () => time,
    spawn: vi.fn((handlers: BackendHandlers) => {
      const child = { handlers, postMessage: vi.fn(), kill: vi.fn(() => true) }
      children.push(child)
      return child
    }),
  }
  const supervisor = new BackendSupervisor(options)
  const ready = (index = children.length - 1) => children[index]!.handlers.message({ type: "ready", address: `http://127.0.0.1:${4000 + index}`, token: `token-${index}` })
  const crash = (index = children.length - 1, code = 9) => children[index]!.handlers.exit(code)
  return { supervisor, options, children, ready, crash, advance: (ms: number) => { time += ms } }
}

describe("BackendSupervisor", () => {
  it("connects when the backend is ready and reports an unexpected exit", () => {
    const { supervisor, options, ready, crash } = harness()
    expect(supervisor.start()).toBe(true)
    expect(supervisor.start()).toBe(false)
    expect(supervisor.state()).toMatchObject({ status: "starting", restarts: 0, logPath: "/workspace/logs/backend.log" })
    ready()
    expect(options.onReady).toHaveBeenCalledWith({ address: "http://127.0.0.1:4000", token: "token-0" })
    expect(options.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" }))
    crash(0, 9)
    expect(supervisor.running).toBe(false)
    expect(options.onUnavailable).toHaveBeenCalledWith("The backend stopped unexpectedly (exit code 9).")
    expect(options.onState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unavailable", failures: 1, message: "The backend stopped unexpectedly (exit code 9)." }))
    expect(options.log).toHaveBeenCalledWith("The backend stopped unexpectedly (exit code 9).")
    expect(options.onStopped).not.toHaveBeenCalled()
  })

  it("restarts only after an exit, with a new process whose predecessor is ignored", () => {
    const { supervisor, options, children, ready, crash } = harness()
    supervisor.start()
    ready(0)
    expect(supervisor.restart()).toBe(false)
    crash(0)
    expect(supervisor.restart()).toBe(true)
    expect(supervisor.restart()).toBe(false)
    expect(options.spawn).toHaveBeenCalledTimes(2)
    expect(supervisor.state()).toMatchObject({ status: "starting", restarts: 1, message: undefined })
    // Late events of the replaced process must not reconnect or report again.
    children[0]!.handlers.message({ type: "ready", address: "http://127.0.0.1:1", token: "stale" })
    children[0]!.handlers.exit(1)
    expect(options.onReady).toHaveBeenCalledTimes(1)
    expect(options.onUnavailable).toHaveBeenCalledTimes(1)
    ready(1)
    expect(options.onReady).toHaveBeenLastCalledWith({ address: "http://127.0.0.1:4001", token: "token-1" })
    expect(supervisor.state().status).toBe("ready")
  })

  it("stops offering restarts after repeated failures and keeps the startup error", () => {
    const { supervisor, children, crash } = harness()
    supervisor.start()
    for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
      children.at(-1)!.handlers.message({ type: "failed", message: "Error: database is locked" })
      crash(children.length - 1, 1)
      expect(supervisor.state()).toMatchObject({ status: "unavailable", failures: attempt })
      expect(supervisor.restart()).toBe(true)
    }
    children.at(-1)!.handlers.message({ type: "failed", message: "Error: database is locked" })
    crash(children.length - 1, 1)
    expect(supervisor.state()).toMatchObject({ status: "failed", failures: MAX_FAILURES, message: "The backend could not start: Error: database is locked" })
    expect(supervisor.restart()).toBe(false)
    expect(children).toHaveLength(MAX_FAILURES)
  })

  it("counts a crash after a stable period as a new first failure", () => {
    const { supervisor, ready, crash, advance } = harness()
    supervisor.start()
    ready()
    crash()
    supervisor.restart()
    ready()
    crash()
    expect(supervisor.state().failures).toBe(2)
    supervisor.restart()
    ready()
    advance(STABLE_MS)
    crash()
    expect(supervisor.state()).toMatchObject({ status: "unavailable", failures: 1 })
  })

  it("shuts down on request, acknowledges the stop and never restarts while stopping", () => {
    const { supervisor, options, children, ready } = harness()
    expect(supervisor.stop()).toBe(false)
    supervisor.start()
    ready()
    expect(supervisor.stop()).toBe(true)
    expect(children[0]!.postMessage).toHaveBeenCalledWith({ type: "shutdown" })
    children[0]!.handlers.message({ type: "stopped" })
    expect(children[0]!.postMessage).toHaveBeenLastCalledWith({ type: "exit" })
    supervisor.kill()
    expect(children[0]!.kill).toHaveBeenCalledOnce()
    children[0]!.handlers.exit(0)
    expect(options.onStopped).toHaveBeenCalledOnce()
    expect(options.onUnavailable).not.toHaveBeenCalled()
    expect(supervisor.start()).toBe(false)
    expect(supervisor.restart()).toBe(false)
    supervisor.kill()
  })
})
