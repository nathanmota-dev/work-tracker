/** Statuses an agent may report for one posting; `gave_up` is only ever derived here. */
export const AGENT_STATUSES = ["scored", "expired", "unreachable"] as const;
export const RANKING_STATUSES = [...AGENT_STATUSES, "gave_up"] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type RankingStatus = (typeof RANKING_STATUSES)[number];

/** Default number of postings fetched and scored per run; the rest are deferred. */
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
/** Unreachable postings are given up on after this many attempts... */
export const GIVE_UP_ATTEMPTS = 3;
/** ...spread over at least this long between the first and the last attempt. */
export const GIVE_UP_HOURS = 48;
export const MAX_ITEMS = 3;
export const MAX_ITEM_LENGTH = 280;
export const MAX_ERROR_LENGTH = 200;

export interface DimensionScores {
  technical: number;
  experience: number;
  career: number;
}

/** What the triage skill reports for one posting, as read from `ranking save --file`. */
export interface RankingInput {
  jobId: number;
  status: string;
  technical?: unknown;
  experience?: unknown;
  career?: unknown;
  strengths?: unknown;
  gaps?: unknown;
  fetch_error?: unknown;
}

export interface JobRanking {
  job_id: number;
  status: RankingStatus;
  technical: number | null;
  experience: number | null;
  career: number | null;
  overall: number | null;
  verdict: string | null;
  strengths: string[];
  gaps: string[];
  fetch_attempts: number;
  first_unreachable_at: string | null;
  last_error: string | null;
  ranked_at: string;
}

/** A ranking result that cannot be stored; `status` is the HTTP status to answer with. */
export class RankingError extends Error {
  override name = "RankingError";
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
