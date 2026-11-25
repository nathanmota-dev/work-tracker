import type { Database } from "../db/sqlite.ts";
import { saveGuardedDescription } from "../postings/description.ts";
import { postingText } from "./posting-text.ts";

/** Only jobs saved this recently are fetched, so an old backlog never floods LinkedIn. */
export const RECENT_DAYS = 7;
/** Failed fetches per job before it is left for the user or the triage skill. */
export const MAX_ATTEMPTS = 3;

/**
 * @property fetchDetails The LinkedIn MCP `get_job_details` call.
 * @property busy Whether an agent, Apply or another LinkedIn call may be using the shared browser.
 * @property broadcast Notifies the dashboard; never fed back into `observe`.
 * @property [delayMs] Quiet time after the last change before a pass starts.
 * @property [busyMs] How often a pass checks again while `busy` holds.
 * @property [retryMs] Wait after a job's first failure; it grows with each attempt.
 */
export interface DescriptionFetcherOptions {
  db: () => Database;
  fetchDetails: (linkedinJobId: string) => Promise<unknown>;
  busy: () => boolean;
  broadcast: (event: unknown) => void;
  delayMs?: number;
  busyMs?: number;
  retryMs?: number;
  now?: () => number;
}

type Pending = { id: number; linkedin_job_id: string };

/** Active, recently saved LinkedIn jobs that still have no description, oldest first. */
export function missingDescriptions(d: Database): Pending[] {
  return d.query(`SELECT id, linkedin_job_id FROM jobs
    WHERE archived_at IS NULL AND trim(COALESCE(linkedin_job_id, '')) <> '' AND trim(COALESCE(description, '')) = ''
      AND scouted_at >= datetime('now', ?)
    ORDER BY id`).all(`-${RECENT_DAYS} days`) as Pending[];
}

/**
 * Fills in the description of new LinkedIn jobs saved without one, so their
 * Resume match is computed without an agent run. Jobs saved with a description
 * are never fetched. One job at a time, only while nothing else is using the
 * LinkedIn browser; every text passes the posting guard before it is stored.
 * Failed attempts are kept in memory, so a restart retries them.
 */
export class DescriptionFetcher {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private again = false;
  private closed = false;
  private failures = new Map<number, { attempts: number; retryAt: number }>();
  private readonly delayMs: number;
  private readonly busyMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;

  constructor(private options: DescriptionFetcherOptions) {
    this.delayMs = options.delayMs ?? 5000;
    this.busyMs = options.busyMs ?? 30000;
    this.retryMs = options.retryMs ?? 10 * 60000;
    this.now = options.now ?? Date.now;
  }

  /** Saved jobs and finished agent sessions start a pass. */
  observe(event: unknown): void {
    const { type, table } = (event ?? {}) as { type?: string; table?: string };
    if ((type === "changed" && table === "jobs") || type === "acp-status" || type === "acp-exit") this.schedule();
  }

  /** Start a pass after `delayMs` of quiet; a later call restarts the wait. */
  schedule(delayMs = this.delayMs): void {
    if (this.closed) return;
    if (this.running) { this.again = true; return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pass(), delayMs);
    this.timer.unref?.();
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
  }

  /** Fetch every due job in turn; stops while the browser is in use and resumes later. */
  async pass(): Promise<void> {
    if (this.closed || this.running) return;
    this.running = true;
    this.again = false;
    let waitMs: number | null = null;
    try {
      for (let job = this.next(); job && !this.closed; job = this.next()) {
        if (this.options.busy()) { waitMs = this.busyMs; break; }
        await this.fetch(job);
      }
      waitMs ??= this.nextRetry();
    } finally {
      this.running = false;
    }
    if (this.again) this.schedule();
    else if (waitMs !== null) this.schedule(waitMs);
  }

  private next(): Pending | undefined {
    const now = this.now();
    return missingDescriptions(this.options.db()).find(job => {
      const failure = this.failures.get(job.id);
      return !failure || (failure.attempts < MAX_ATTEMPTS && failure.retryAt <= now);
    });
  }

  /** Wait until the earliest job that may still be retried; null when none is left. */
  private nextRetry(): number | null {
    const pending = new Set(missingDescriptions(this.options.db()).map(job => job.id));
    const due = [...this.failures].filter(([id, failure]) => pending.has(id) && failure.attempts < MAX_ATTEMPTS).map(([, failure]) => failure.retryAt);
    return due.length ? Math.max(0, Math.min(...due) - this.now()) : null;
  }

  private async fetch(job: Pending): Promise<void> {
    let text = "";
    try { text = postingText(await this.options.fetchDetails(job.linkedin_job_id)); } catch { /* counted below */ }
    const d = this.options.db();
    // The agent or the user may have saved a description while LinkedIn answered.
    const current = d.query("SELECT description FROM jobs WHERE id = ?").get(job.id) as { description: string | null } | undefined;
    if (!current || current.description?.trim()) { this.failures.delete(job.id); return; }
    if (text && saveGuardedDescription(d, job.id, text).description) {
      this.failures.delete(job.id);
      this.options.broadcast({ type: "changed", table: "jobs" });
      return;
    }
    const attempts = (this.failures.get(job.id)?.attempts ?? 0) + 1;
    this.failures.set(job.id, { attempts, retryAt: this.now() + this.retryMs * attempts });
  }
}
