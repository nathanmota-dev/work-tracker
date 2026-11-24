import type { SessionManager, AcpRunResult } from "../acp/session.ts";
import { PreparationError } from "./sources.ts";

export type PreparationAgent = Pick<SessionManager, "run" | "cancel"> & Partial<Pick<SessionManager, "subscribe" | "isRunning">>;
/** Who started the active execution, so each service only follows and cancels its own. */
export type SlotOwner = "preparation" | "variant";
type Active = { id: string; owner: SlotOwner; controller: AbortController };

/**
 * The single agent execution shared by Apply, the batch queue, Launch and resume
 * variants: one instance is injected into every service so they never run at once.
 */
export class ExecutionSlot {
  private active: Active | null = null;
  private task: Promise<void> | null = null;
  constructor(private acp: PreparationAgent) {}
  get isBusy(): boolean { return !!this.active || !!this.acp.isRunning; }
  get activeId(): string | undefined { return this.active?.id; }
  /** The active execution's ID when `owner` started it. */
  activeFor(owner: SlotOwner): string | undefined { return this.active?.owner === owner ? this.active.id : undefined; }
  assertIdle(): void { if (this.isBusy) throw new PreparationError("Finish or cancel the active execution first.", 409); }
  /** Run `work` in the background; `fail` receives its error and whether it was cancelled. */
  start(id: string, owner: SlotOwner, work: (signal: AbortSignal) => Promise<void>, fail: (error: unknown, cancelled: boolean) => void, done: () => void): void {
    const controller = new AbortController();
    this.active = { id, owner, controller };
    this.task = work(controller.signal).catch(error => fail(error, controller.signal.aborted)).finally(() => { this.active = null; this.task = null; done(); });
  }
  /** Occupy the slot while the caller awaits `work`. */
  async hold<T>(id: string, owner: SlotOwner, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.active = { id, owner, controller };
    const result = work(controller.signal);
    this.task = result.then(() => {}, () => {});
    try { return await result; }
    finally { this.active = null; this.task = null; }
  }
  /** Abort the active execution and wait until it settles. */
  async cancel(): Promise<void> {
    this.active?.controller.abort();
    this.acp.cancel();
    await this.task;
  }
  async close(): Promise<void> { await this.cancel(); }
  /**
   * Run one agent skill. False while it waits for sign-in; throws when it was
   * cancelled or failed.
   */
  async runAgent(provider: string, model: string | null, skill: string, params: Record<string, string>, signal: AbortSignal): Promise<boolean> {
    const result = await this.acp.run(provider, skill, params, model ?? undefined) as AcpRunResult | undefined;
    if (signal.aborted || result?.status === "cancelled") throw new Error("Cancelled");
    if (result?.status === "waiting_for_sign_in") return false;
    if (result?.status === "error") throw new Error(result.message ?? "Agent execution failed.");
    return true;
  }
}
