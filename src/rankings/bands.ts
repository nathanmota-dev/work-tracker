import type { DimensionScores } from "./types.ts";

/**
 * Weights of the triage score. The original framework also weighs a behavioral
 * dimension; Work Tracker has no behavioral profile, so its share is spread over
 * the remaining three (see docs/features-e-fluxos.md).
 */
export const RANK_WEIGHTS: Readonly<DimensionScores> = { technical: 0.35, experience: 0.3, career: 0.35 };

/** Verdict bands, highest first: a score reaches the first band whose floor it meets. */
export const VERDICT_BANDS = [
  { min: 75, label: "Strong Fit" },
  { min: 60, label: "Good Fit" },
  { min: 45, label: "Moderate Fit" },
  { min: 30, label: "Weak Fit" },
  { min: 0, label: "Poor Fit" },
] as const;

export type Verdict = (typeof VERDICT_BANDS)[number]["label"];

/** Overall triage score, computed here and never taken from the agent. */
export function overallScore(scores: DimensionScores): number {
  const total = scores.technical * RANK_WEIGHTS.technical + scores.experience * RANK_WEIGHTS.experience + scores.career * RANK_WEIGHTS.career;
  // Round half up after removing floating-point noise (e.g. 74.99999999).
  return Math.round(Math.round(total * 1000) / 1000);
}

export function verdictBand(overall: number): Verdict {
  return VERDICT_BANDS.find((band) => overall >= band.min)?.label ?? "Poor Fit";
}
