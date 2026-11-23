import type { Database } from "../db/sqlite.ts";
import { guardPosting, type PostingFindings, type PostingGuardResult } from "./guard/index.ts";

/** Verdict of a job whose description predates the guard or was never saved through it. */
export const NOT_CHECKED = "Not checked";
/** Quoted items kept per finding list; the counts always cover every item. */
const STORED_ITEMS = 10;
const LISTS = ["instruction_like", "invisible_text", "homoglyph_runs", "hidden_blocks", "hidden_urls", "tool_mentions"] as const;
export type GuardList = typeof LISTS[number];

/**
 * The guard result kept in `jobs.description_guard_json`: counts and short
 * excerpts for the user, never the removed content itself.
 */
export interface StoredGuard {
  version: 1;
  verdict: string;
  flagged: boolean;
  checked_at: string;
  counts: Record<GuardList, number>;
  excerpts: Record<GuardList, string[]>;
  invisible_chars: Record<string, number>;
  invisible_flagged: number;
}

export function storedGuard(result: PostingGuardResult, checkedAt = new Date().toISOString()): StoredGuard {
  const findings: PostingFindings = result.findings;
  return {
    version: 1,
    verdict: result.verdict,
    flagged: result.flagged,
    checked_at: checkedAt,
    counts: Object.fromEntries(LISTS.map(key => [key, findings[key].length])) as Record<GuardList, number>,
    excerpts: Object.fromEntries(LISTS.map(key => [key, findings[key].slice(0, STORED_ITEMS)])) as Record<GuardList, string[]>,
    invisible_chars: findings.invisible_chars,
    invisible_flagged: findings.invisible_flagged,
  };
}

/**
 * Clean a description before it is saved. Only the cleaned text is ever stored,
 * so no agent reads the raw posting; an empty or absent description has no guard.
 */
export function guardDescription(raw: string | null | undefined): { description: string | null; guardJson: string | null; guard: StoredGuard | null } {
  if (!raw?.trim()) return { description: null, guardJson: null, guard: null };
  const result = guardPosting(raw);
  const guard = storedGuard(result);
  return { description: result.text || null, guardJson: JSON.stringify(guard), guard };
}

/** The stored guard, or null when the job was never checked or the value is unreadable. */
export function parseGuard(json: unknown): StoredGuard | null {
  if (typeof json !== "string" || !json) return null;
  try {
    const value = JSON.parse(json) as Partial<StoredGuard>;
    return value && typeof value === "object" && typeof value.verdict === "string" ? value as StoredGuard : null;
  } catch { return null; }
}

/** The verdict line an agent may quote; "Not checked" for jobs saved before the guard. */
export function guardVerdict(json: unknown): string {
  return parseGuard(json)?.verdict ?? NOT_CHECKED;
}

/**
 * Save a pasted or fetched description through the guard. Returns the cleaned
 * text, or null when nothing readable remained (the job is left unchanged).
 */
export function saveGuardedDescription(d: Database, jobId: number, raw: string): { description: string | null; guard: StoredGuard | null } {
  const { description, guardJson, guard } = guardDescription(raw);
  if (description) d.query("UPDATE jobs SET description = ?, description_guard_json = ? WHERE id = ?").run(description, guardJson, jobId);
  return { description, guard };
}
