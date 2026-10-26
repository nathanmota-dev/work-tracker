export type BackendConnection = { address: string; token: string }
/**
 * Backend lifecycle as shown by the interface.
 *
 * @property restarts Restarts requested since the app opened.
 * @property failures Consecutive unexpected exits that happened before the
 *   backend stayed ready for `STABLE_MS`; restarting stops at `MAX_FAILURES`.
 * @property [message] Why the last process stopped.
 */
export type BackendState = {
  status: "starting" | "ready" | "unavailable" | "failed"
  restarts: number
  failures: number
  message?: string
  logPath: string
}
export type BackendMessage = { type?: string; address?: string; token?: string; message?: string } | undefined
export type BackendChild = { postMessage(message: unknown): void; kill(): boolean }
export type BackendHandlers = { message(message: BackendMessage): void; exit(code: number): void }
export const MAX_FAILURES = 3
export const STABLE_MS = 30_000

/**
 * Owns the backend process: reports unexpected exits, starts a new process only
 * when asked, and stops offering restarts after repeated failures. Events of a
 * replaced process are ignored so a restart never duplicates connections.
 */
export class BackendSupervisor {
  private child: BackendChild | undefined
  private stopping = false
  private readyAt: number | undefined
  private failure: string | undefined
  private current: BackendState

  constructor(private readonly options: {
    spawn(handlers: BackendHandlers): BackendChild
    logPath: string
    log(line: string): void
    onReady(connection: BackendConnection): void
    onUnavailable(message: string): void
    onState(state: BackendState): void
    onStopped(): void
    now?: () => number
  }) {
    this.current = { status: "starting", restarts: 0, failures: 0, logPath: options.logPath }
  }

  get running() { return this.child !== undefined }
  state(): BackendState { return { ...this.current } }

  start() {
    if (this.child || this.stopping) return false
    this.failure = undefined
    this.options.log(`Starting backend (attempt ${this.current.restarts + 1}).`)
    const child: BackendChild = this.options.spawn({
      message: message => { if (this.child === child) this.message(message) },
      exit: code => { if (this.child === child) this.exit(code) },
    })
    this.child = child
    return true
  }

  /** Start a new process after an unexpected exit; refused while one runs or after repeated failures. */
  restart() {
    if (this.current.status !== "unavailable" || this.child || this.stopping) return false
    this.update({ status: "starting", restarts: this.current.restarts + 1, message: undefined })
    return this.start()
  }

  stop() {
    if (!this.child) return false
    this.stopping = true
    this.child.postMessage({ type: "shutdown" })
    return true
  }

  kill() { this.child?.kill() }

  private message(message: BackendMessage) {
    if (message?.type === "ready" && message.address && message.token) {
      this.readyAt = this.now()
      this.update({ status: "ready", message: undefined })
      this.options.onReady({ address: message.address, token: message.token })
    }
    if (message?.type === "failed") this.failure = `The backend could not start: ${message.message ?? "unknown error"}`
    if (message?.type === "stopped") this.child?.postMessage({ type: "exit" })
  }

  private exit(code: number) {
    this.child = undefined
    if (this.stopping) {
      this.options.log(`Backend stopped (code ${code}).`)
      this.options.onStopped()
      return
    }
    const stable = this.readyAt !== undefined && this.now() - this.readyAt >= STABLE_MS
    const failures = stable ? 1 : this.current.failures + 1
    const message = this.failure ?? `The backend stopped unexpectedly (exit code ${code}).`
    this.readyAt = undefined
    this.options.log(message)
    this.options.onUnavailable(message)
    this.update({ status: failures >= MAX_FAILURES ? "failed" : "unavailable", failures, message })
  }

  private update(patch: Partial<BackendState>) {
    this.current = { ...this.current, ...patch }
    this.options.onState(this.state())
  }

  private now() { return (this.options.now ?? Date.now)() }
}
