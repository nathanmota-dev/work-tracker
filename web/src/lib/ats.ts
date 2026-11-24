import { useApi, type Row } from "./api"

export type AtsBand = "strong" | "partial" | "weak"
/** A job's best saved resume, as `GET /api/ats/best` lists it; `score` is null with too few keywords. */
export type AtsBest = { job_id: number; document_key: string; variant_id: string | null; label: string; score: number | null; band: AtsBand | null }
export type AtsKeyword = { term: string; category: string; weight: number; section: "required" | "preferred" | "other" }
export type AtsDocumentScore = Omit<AtsBest, "job_id"> & { kind: "variant" | "base" | "document"; reason?: "too_few_keywords"; matched: AtsKeyword[]; missing: AtsKeyword[]; requiredMissing: string[] }
export type AtsJobScores = { job_id: number; keywords: AtsKeyword[]; documents: AtsDocumentScore[] }
export type ScoreTone = "good" | "warn" | "bad" | "none"

export const ATS_TITLE = "Resume match (ATS keywords)"
/** Shown wherever the ATS score appears: it is keyword coverage, not a prediction. */
export const ATS_NOTE = "Estimates keyword coverage the way keyword-based ATS filters do. It does not predict a hiring decision."
export const NOT_ENOUGH = "Not enough keywords"
export const bandLabels: Record<AtsBand, string> = { strong: "Strong match", partial: "Partial match", weak: "Weak match" }
export const bandTones: Record<AtsBand, ScoreTone> = { strong: "good", partial: "warn", weak: "bad" }

/** "82 · Back-End · C#"; a job with too few keywords reads "Not enough keywords", never 0. */
export function atsLabel(row: Pick<AtsBest, "score" | "label">) {
  return row.score === null ? NOT_ENOUGH : `${row.score} · ${row.label}`
}
export function atsTone(row: Pick<AtsBest, "band"> | undefined): ScoreTone {
  return row?.band ? bandTones[row.band] : "none"
}
/** Triage verdicts in the same colors: Strong and Good green, Moderate amber, Weak and Poor red. */
export function verdictTone(verdict: unknown): ScoreTone {
  const word = String(verdict ?? "").split(" ")[0]
  return word === "Strong" || word === "Good" ? "good" : word === "Moderate" ? "warn" : word === "Weak" || word === "Poor" ? "bad" : "none"
}

/** `ats/best` refreshes on `changed` events of jobs and saved resumes; see the dependencies in api.ts. */
export function useAtsBest() {
  return useApi<AtsBest[]>("ats/best")
}
export function useAtsJob(jobId: unknown) {
  return useApi<AtsJobScores>(`ats/jobs/${Number(jobId)}`)
}
/** Attach each job's best resume as `ats_match`, for the Resume match column and its sort. */
export function withAtsMatch(rows: Row[], best: AtsBest[] | undefined): Row[] {
  if (!Array.isArray(best) || !best.length) return rows
  const byJob = new Map(best.map(row => [Number(row.job_id), row]))
  return rows.map(row => byJob.has(Number(row.id)) ? { ...row, ats_match: byJob.get(Number(row.id)) } : row)
}
const matchScore = (row: Row) => typeof (row.ats_match as AtsBest | undefined)?.score === "number" ? (row.ats_match as AtsBest).score! : -1
/** Highest resume match first; unscored rows keep their order after. */
export function byAtsMatch(rows: Row[]): Row[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => matchScore(b.row) - matchScore(a.row) || a.index - b.index).map(item => item.row)
}
/** Saved resumes ordered by their score for the job, best first; unscored ones keep their order after. */
export function byJobScore<T extends { id: string }>(variants: T[], scores: AtsDocumentScore[] | undefined): T[] {
  const score = (id: string) => scores?.find(item => item.variant_id === id)?.score ?? -1
  return variants.map((variant, index) => ({ variant, index })).sort((a, b) => score(b.variant.id) - score(a.variant.id) || a.index - b.index).map(item => item.variant)
}
