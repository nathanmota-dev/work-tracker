import type { Database } from "../db/sqlite.ts";
import { deadlineUrgency, localToday } from "../deadlines/urgency.ts";
import { guardVerdict } from "../postings/description.ts";
import { DEFAULT_LIMIT, MAX_LIMIT, RankingError, type RankingStatus } from "./types.ts";

export interface CandidateOptions {
  limit?: number;
  /** Re-rank jobs that were already scored, expired or given up on (e.g. after a profile change). */
  all?: boolean;
  /** Restrict the run to these jobs (the user's selection). */
  jobIds?: number[];
  today?: string;
}

/** One posting to fetch and score, with the saved (already guarded) description when there is one. */
export interface RankingCandidate {
  job_id: number;
  title: string | null;
  company: string | null;
  link: string | null;
  linkedin_job_id: string | null;
  deadline: string | null;
  closing_soon: boolean;
  description: string | null;
  guard_verdict: string;
  previous_status: RankingStatus | null;
  fetch_attempts: number;
}

/**
 * @property eligible Jobs this run could rank; `items` holds the first `limit` of them.
 * @property deferred Eligible jobs beyond the limit, left for the next run.
 * @property expired Jobs skipped without a fetch because their saved deadline passed.
 * @property already_ranked Jobs skipped because they are already scored, expired or given up on.
 */
export interface RankingCandidates {
  limit: number;
  all: boolean;
  items: RankingCandidate[];
  eligible: number;
  deferred: number;
  expired: number;
  already_ranked: number;
}

type Row = Omit<RankingCandidate, "closing_soon" | "guard_verdict" | "fetch_attempts"> & {
  description_guard_json: string | null; scouted_at: string | null; ranked_at: string | null; fetch_attempts: number | null;
};

export function rankingLimit(value: unknown): number {
  if (value == null || value === "") return DEFAULT_LIMIT;
  const limit = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new RankingError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  return limit;
}

export function rankingJobIds(value: unknown): number[] | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*(,[1-9]\d*)*$/.test(value)) throw new RankingError("job ids must be a comma-separated list of positive integers");
  return [...new Set(value.split(",").map(Number))];
}

const byText = (a: string | null, b: string | null) => (a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0);

/** Soonest deadline first, then the most recently saved. `--all` starts with the least recently ranked so repeated runs advance. */
function order(rows: Row[], all: boolean): Row[] {
  return [...rows].sort((a, b) => (all ? (a.ranked_at ?? "").localeCompare(b.ranked_at ?? "") : 0)
    || byText(a.deadline, b.deadline) || byText(b.scouted_at, a.scouted_at) || b.job_id - a.job_id);
}

/**
 * Active jobs without a submitted application that still need triage. By default
 * only unranked and unreachable jobs (retried) qualify; `all` re-ranks the rest.
 * Selecting candidates is a query: the skill never reads the whole job list.
 */
export function rankingCandidates(d: Database, options: CandidateOptions = {}): RankingCandidates {
  const limit = rankingLimit(options.limit);
  const all = options.all === true;
  const today = options.today ?? localToday();
  const ids = options.jobIds;
  const rows = d.query(`
    SELECT j.id AS job_id, j.title, j.company_name AS company, j.link, j.linkedin_job_id, j.deadline, j.description,
           j.description_guard_json, j.scouted_at, r.status AS previous_status, r.fetch_attempts, r.ranked_at
    FROM jobs j LEFT JOIN job_rankings r ON r.job_id = j.id
    WHERE j.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.submission_status = 'submitted')
      ${ids ? `AND j.id IN (${ids.map(() => "?").join(", ")})` : ""}
  `).all(...(ids ?? [])) as unknown as Row[];
  const open = rows.filter((row) => deadlineUrgency(row.deadline, today).level !== "overdue");
  const eligible = order(open.filter((row) => all || !row.previous_status || row.previous_status === "unreachable"), all);
  const items = eligible.slice(0, limit).map(({ description_guard_json, scouted_at: _scouted, ranked_at: _ranked, ...row }) => ({
    ...row,
    fetch_attempts: row.fetch_attempts ?? 0,
    closing_soon: deadlineUrgency(row.deadline, today).level === "soon",
    guard_verdict: guardVerdict(description_guard_json),
  }));
  return {
    limit, all, items, eligible: eligible.length, deferred: eligible.length - items.length,
    expired: rows.length - open.length, already_ranked: open.length - eligible.length,
  };
}
