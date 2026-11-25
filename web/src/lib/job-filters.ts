import type { Row } from "@/lib/api"
import type { ScoreTone } from "@/lib/ats"
import { byDeadline } from "@/lib/deadline"
import { byScore } from "@/lib/ranking"
import { byAtsMatch } from "@/lib/ats"

export type JobOrder = "saved" | "deadline" | "score" | "match"
export type JobFilters = { q: string; workType: string; score: string; order: JobOrder }

export const workTypeOptions = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on-site", label: "On-site" },
]
export const scoreOptions = [
  { value: "good", label: "Strong" },
  { value: "warn", label: "Partial" },
  { value: "bad", label: "Weak" },
  { value: "none", label: "Not scored" },
]
export const orderOptions: { value: JobOrder; label: string }[] = [
  { value: "saved", label: "Recently saved" },
  { value: "deadline", label: "Soonest deadline" },
  { value: "score", label: "Highest score" },
  { value: "match", label: "Best resume match" },
]

function workType(row: Row) {
  const value = String(row.work_type ?? "").toLowerCase()
  return /remote|remoto/.test(value) ? "remote" : /hybrid|híbrido|hibrido/.test(value) ? "hybrid" : /on.?site|presencial/.test(value) ? "on-site" : ""
}

const SEARCHED = ["title", "company_name", "location", "description", "requirements_json"]

/** Search, work type and score band, then the chosen order. `tone` gives each job's score band. */
export function filterJobs(rows: Row[], filters: JobFilters, tone: (row: Row) => ScoreTone): Row[] {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  const matched = rows.filter(row =>
    (!filters.workType || workType(row) === filters.workType) &&
    (!filters.score || tone(row) === filters.score) &&
    terms.every(term => SEARCHED.some(key => String(row[key] ?? "").toLowerCase().includes(term))))
  return filters.order === "deadline" ? byDeadline(matched)
    : filters.order === "score" ? byScore(matched)
    : filters.order === "match" ? byAtsMatch(matched)
    : matched
}
