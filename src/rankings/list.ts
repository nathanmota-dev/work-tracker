import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { deadlineUrgency, localToday } from "../deadlines/urgency.ts";
import type { JobRanking, RankingStatus } from "./types.ts";

/** Why a posting counts as expired: the agent saw it closed, or its saved deadline passed. */
export type ExpiredReason = "posting" | "deadline" | null;

/** Read-time state of a job's ranking; derived from the current deadline and never written back. */
export interface RankingState {
  status: RankingStatus | null;
  expired_reason: ExpiredReason;
  closing_soon: boolean;
}

/**
 * A saved deadline that passed reads as expired, and one within 7 days as
 * closing soon, without fetching anything. A job without a deadline is never
 * inferred to be expired, and a corrected deadline is reflected on the next read.
 */
export function rankingState(status: RankingStatus | null, deadline: string | null, today: string = localToday()): RankingState {
  const { level } = deadlineUrgency(deadline, today);
  if (level === "overdue") return { status: "expired", expired_reason: "deadline", closing_soon: false };
  return { status, expired_reason: status === "expired" ? "posting" : null, closing_soon: level === "soon" };
}

export type RankingView = Omit<JobRanking, "status"> & RankingState & {
  title: string | null;
  company_name: string | null;
  link: string | null;
  deadline: string | null;
  archived_at: string | null;
};

type Sortable = { status: RankingStatus | null; overall: number | null; closing_soon: boolean; deadline: string | null };

/** Highest score first; a deadline within 7 days wins ties, then the sooner deadline. Unscored rows keep their order after. */
export function byRank<T extends Sortable>(rows: T[]): T[] {
  const score = (row: T) => (row.status === "scored" && row.overall != null ? row.overall : -1);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => score(b.row) - score(a.row)
      || Number(b.row.closing_soon) - Number(a.row.closing_soon)
      || (a.row.deadline && b.row.deadline ? a.row.deadline.localeCompare(b.row.deadline) : a.row.deadline ? -1 : b.row.deadline ? 1 : 0)
      || a.index - b.index)
    .map(({ row }) => row);
}

type Row = Omit<RankingView, keyof RankingState | "strengths" | "gaps"> & { status: RankingStatus; strengths_json: string; gaps_json: string };

/** Every ranked job, plus unranked ones whose deadline already passed, in ranking order. */
export function listRankings(d: Database = db(), today: string = localToday()): RankingView[] {
  const rows = d.query(`
    SELECT j.id AS job_id, j.title, j.company_name, j.link, j.deadline, j.archived_at,
           r.status, r.technical, r.experience, r.career, r.overall, r.verdict, r.strengths_json, r.gaps_json,
           r.fetch_attempts, r.first_unreachable_at, r.last_error, r.ranked_at
    FROM jobs j LEFT JOIN job_rankings r ON r.job_id = j.id
    WHERE r.job_id IS NOT NULL OR j.deadline IS NOT NULL
    ORDER BY j.scouted_at DESC, j.id DESC
  `).all() as unknown as Row[];
  return byRank(rows.flatMap(({ strengths_json, gaps_json, ...row }) => {
    const state = rankingState(row.status ?? null, row.deadline, today);
    if (!state.status) return [];
    return [{ ...row, ...state, fetch_attempts: row.fetch_attempts ?? 0, strengths: JSON.parse(strengths_json ?? "[]") as string[], gaps: JSON.parse(gaps_json ?? "[]") as string[] }];
  }));
}
