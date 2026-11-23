import { RankingError, type RankingInput } from "./types.ts";

const KEYS = new Set(["status", "scores", "strengths", "gaps", "fetch_error"]);
const SCORE_KEYS = new Set(["technical", "experience", "career"]);

/**
 * Reads the JSON result the triage skill writes for one posting:
 * `{ status, scores: { technical, experience, career }, strengths, gaps, fetch_error }`.
 * The overall score and verdict are computed by Work Tracker, so they are refused here.
 */
export function rankingInput(jobId: number, value: unknown): RankingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RankingError("the result must be a JSON object");
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (key === "overall" || key === "verdict") throw new RankingError(`${key} is computed by Work Tracker from the three scores; leave it out`);
    if (!KEYS.has(key)) throw new RankingError(`unknown field "${key}"; expected ${[...KEYS].join(", ")}`);
  }
  if (typeof result.status !== "string") throw new RankingError("status is required");
  const scores = result.scores;
  if (scores != null && (typeof scores !== "object" || Array.isArray(scores))) throw new RankingError("scores must be an object");
  const dimensions = (scores ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(dimensions))
    if (!SCORE_KEYS.has(key)) throw new RankingError(`unknown score "${key}"; triage uses technical, experience and career only`);
  return {
    jobId,
    status: result.status,
    technical: dimensions.technical,
    experience: dimensions.experience,
    career: dimensions.career,
    strengths: result.strengths,
    gaps: result.gaps,
    fetch_error: result.fetch_error,
  };
}
