import type { JobKeyword } from "./extract.ts";
import { resumeTerms } from "./vocabulary.ts";

/** Raise when the vocabulary, extraction or score changes: every stored score is then recomputed. */
export const ATS_VERSION = 1;
/** Fewer recognized terms than this give no score: a percentage of one or two terms says nothing. */
export const MIN_KEYWORDS = 3;

/** Bands of the ATS keyword score, highest first: a score reaches the first band whose floor it meets. */
export const ATS_BANDS = [
  { min: 70, band: "strong", label: "Strong match" },
  { min: 50, band: "partial", label: "Partial match" },
  { min: 0, band: "weak", label: "Weak match" },
] as const;
export type AtsBand = (typeof ATS_BANDS)[number]["band"];

export function atsBand(score: number): AtsBand {
  return ATS_BANDS.find(band => score >= band.min)?.band ?? "weak";
}

/**
 * How much of a job's keywords one resume covers.
 *
 * @property score 0-100, or null with `reason` when the job names too few terms.
 * @property missing Terms the resume lacks, heaviest first.
 * @property requiredMissing Missing terms from the job's requirements section.
 */
export interface AtsResult {
  score: number | null;
  band: AtsBand | null;
  reason?: "too_few_keywords";
  matched: JobKeyword[];
  missing: JobKeyword[];
  requiredMissing: string[];
}

/**
 * `round(100 × covered weight / total weight)`. A keyword is covered when the
 * resume names it or one of its aliases. `resume` is the resume text, or its
 * terms from `resumeTerms` when the same resume is scored against many jobs.
 */
export function atsScore(keywords: readonly JobKeyword[], resume: string | ReadonlySet<string>): AtsResult {
  const covered = typeof resume === "string" ? resumeTerms(resume) : resume;
  const matched = keywords.filter(keyword => covered.has(keyword.term));
  const missing = keywords.filter(keyword => !covered.has(keyword.term)).sort((a, b) => b.weight - a.weight);
  const requiredMissing = missing.filter(keyword => keyword.section === "required").map(keyword => keyword.term);
  if (keywords.length < MIN_KEYWORDS) return { score: null, band: null, reason: "too_few_keywords", matched, missing, requiredMissing };
  const total = keywords.reduce((sum, keyword) => sum + keyword.weight, 0);
  const score = Math.round((100 * matched.reduce((sum, keyword) => sum + keyword.weight, 0)) / total);
  return { score, band: atsBand(score), matched, missing, requiredMissing };
}
