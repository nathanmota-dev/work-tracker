import type { AtsDocumentScore, AtsKeyword } from "@/lib/ats"

export const keyword = (term: string, section: AtsKeyword["section"] = "required"): AtsKeyword => ({ term, category: "language", weight: section === "required" ? 3 : section === "other" ? 2 : 1, section })

/** One resume's score for a job, as `GET /api/ats/jobs/:id` lists it; override any field. */
export function documentScore(fields: Partial<AtsDocumentScore> = {}): AtsDocumentScore {
  return { document_key: "variant:v1", kind: "variant", variant_id: "v1", label: "Back-End · C#, .NET", score: 82, band: "strong", matched: [keyword("C#")], missing: [], requiredMissing: [], ...fields }
}
