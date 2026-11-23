import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { overallScore, verdictBand } from "./bands.ts";
import {
  AGENT_STATUSES,
  GIVE_UP_ATTEMPTS,
  GIVE_UP_HOURS,
  MAX_ERROR_LENGTH,
  MAX_ITEM_LENGTH,
  MAX_ITEMS,
  RankingError,
  type AgentStatus,
  type DimensionScores,
  type JobRanking,
  type RankingInput,
} from "./types.ts";

type Row = Omit<JobRanking, "strengths" | "gaps"> & { strengths_json: string; gaps_json: string };
const DIMENSIONS = ["technical", "experience", "career"] as const;
const HOUR_MS = 3_600_000;
// Plain text only: no links, HTML tags, Markdown links, emphasis, code or headings.
const MARKUP = [/https?:\/\//i, /\bwww\./i, /<\/?[a-z!][^>]*>/i, /\[[^\]]*\]\([^)]*\)/, /\*\*|__|`/, /^#/];

function parse(row: Row): JobRanking {
  const { strengths_json, gaps_json, ...rest } = row;
  return { ...rest, strengths: JSON.parse(strengths_json) as string[], gaps: JSON.parse(gaps_json) as string[] };
}

export function getRanking(jobId: number, d: Database = db()): JobRanking | null {
  const row = d.query("SELECT * FROM job_rankings WHERE job_id = ?").get(jobId) as Row | undefined;
  return row ? parse(row) : null;
}

function scores(input: RankingInput): DimensionScores {
  const values = DIMENSIONS.map((key) => {
    const value = input[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100)
      throw new RankingError(`${key} must be an integer score from 0 to 100`);
    return value;
  });
  return { technical: values[0]!, experience: values[1]!, career: values[2]! };
}

function items(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS)
    throw new RankingError(`${name} must list 1 to ${MAX_ITEMS} items`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new RankingError(`${name}[${index}] must be non-empty text`);
    const text = item.trim();
    if (/[\r\n]/.test(text)) throw new RankingError(`${name}[${index}] must be a single line`);
    if (text.length > MAX_ITEM_LENGTH) throw new RankingError(`${name}[${index}] has ${text.length} characters; keep it within ${MAX_ITEM_LENGTH}`);
    if (MARKUP.some((pattern) => pattern.test(text))) throw new RankingError(`${name}[${index}] must be plain text, without URLs or markup`);
    return text;
  });
}

/** One short plain-text line, never page text: control characters removed and capped. */
export function shortError(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new RankingError("fetch_error must be text");
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_ERROR_LENGTH) : null;
}

function refuseScores(input: RankingInput, status: AgentStatus): void {
  if (DIMENSIONS.some((key) => input[key] != null)) throw new RankingError(`an ${status} posting has no scores; leave them out`);
  for (const key of ["strengths", "gaps"] as const)
    if (input[key] != null && !(Array.isArray(input[key]) && !input[key].length))
      throw new RankingError(`an ${status} posting has no ${key}; leave them out`);
}

type Values = Omit<Row, "job_id" | "ranked_at">;
const EMPTY = { technical: null, experience: null, career: null, overall: null, verdict: null, strengths_json: "[]", gaps_json: "[]" };

/** Retry bookkeeping for a failed read: counts attempts and gives up after 3 spread over 48 hours. */
function unreachable(previous: JobRanking | null, error: string, at: string): Values {
  const retrying = previous?.status === "unreachable" || previous?.status === "gave_up";
  const attempts = retrying ? previous.fetch_attempts + 1 : 1;
  const first = (retrying && previous.first_unreachable_at) || at;
  const gaveUp = attempts >= GIVE_UP_ATTEMPTS && Date.parse(at) - Date.parse(first) >= GIVE_UP_HOURS * HOUR_MS;
  return { ...EMPTY, status: gaveUp ? "gave_up" : "unreachable", fetch_attempts: attempts, first_unreachable_at: first, last_error: error };
}

function values(input: RankingInput, previous: JobRanking | null, at: string): Values {
  const status = input.status as AgentStatus;
  if (status === "scored") {
    const dimensions = scores(input);
    const overall = overallScore(dimensions);
    // Re-ranking replaces both lists; they never accumulate.
    return { ...dimensions, status, overall, verdict: verdictBand(overall), strengths_json: JSON.stringify(items(input.strengths, "strengths")),
      gaps_json: JSON.stringify(items(input.gaps, "gaps")), fetch_attempts: 0, first_unreachable_at: null, last_error: null };
  }
  refuseScores(input, status);
  const error = shortError(input.fetch_error);
  if (status === "expired") return { ...EMPTY, status, fetch_attempts: 0, first_unreachable_at: null, last_error: error };
  if (!error) throw new RankingError("an unreachable posting needs a short fetch_error naming the failure (e.g. \"404 Not Found\")");
  return unreachable(previous, error, at);
}

/**
 * Stores the triage result of one posting, replacing its previous one. The
 * overall score and verdict are computed here from the three dimension scores.
 */
export function saveRanking(input: RankingInput, d: Database = db(), at: string = now()): JobRanking {
  if (!Number.isInteger(input.jobId) || input.jobId < 1) throw new RankingError("job id must be a positive integer");
  if (!AGENT_STATUSES.includes(input.status as AgentStatus))
    throw new RankingError(`status must be one of: ${AGENT_STATUSES.join(", ")}`);
  return d.transaction(() => {
    if (!d.query("SELECT 1 FROM jobs WHERE id = ?").get(input.jobId)) throw new RankingError(`job #${input.jobId} not found`, 404);
    const row = { ...values(input, getRanking(input.jobId, d), at), job_id: input.jobId, ranked_at: at };
    const columns = Object.keys(row) as (keyof typeof row)[];
    d.query(`INSERT INTO job_rankings (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(job_id) DO UPDATE SET ${columns.filter((key) => key !== "job_id").map((key) => `${key} = excluded.${key}`).join(", ")}`)
      .run(...columns.map((key) => row[key]));
    return getRanking(input.jobId, d)!;
  })();
}
