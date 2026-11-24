import { ScoreBadge } from "@/components/score-badge"
import { ATS_NOTE, ATS_TITLE, NOT_ENOUGH, atsLabel, atsTone, bandLabels, useAtsJob, type AtsBest, type AtsDocumentScore, type AtsKeyword } from "@/lib/ats"

/** A resume's score for a job: "82 · Back-End · C#" and its band in words, or "Not enough keywords". */
export function ResumeMatchBadge({ match }: { match: Pick<AtsBest, "score" | "band" | "label"> | undefined }) {
  if (!match) return <span>—</span>
  return (
    <ScoreBadge tone={atsTone(match)} title={ATS_NOTE} className="flex-col items-start">
      <span>{atsLabel(match)}</span>
      {match.band && <span className="font-normal">{bandLabels[match.band]}</span>}
    </ScoreBadge>
  )
}

/** "82 · Strong match", without the resume's name, where the name is already shown. */
export function ScoreOnlyBadge({ match }: { match: Pick<AtsBest, "score" | "band"> }) {
  return <ScoreBadge tone={atsTone(match)} title={ATS_NOTE}>{match.score === null || !match.band ? NOT_ENOUGH : `${match.score} · ${bandLabels[match.band]}`}</ScoreBadge>
}

/** Required terms first, then by weight. */
export function requiredFirst(terms: AtsKeyword[]) {
  return [...terms].sort((a, b) => Number(b.section === "required") - Number(a.section === "required") || b.weight - a.weight)
}

function Terms({ title, terms }: { title: string; terms: AtsKeyword[] }) {
  if (!terms.length) return null
  return (
    <p className="text-xs"><span className="font-medium">{title}: </span>
      {terms.map((term, index) => <span key={term.term}>{index ? ", " : ""}{term.term}{term.section === "required" ? " (required)" : ""}</span>)}
    </p>
  )
}

function DocumentMatch({ document }: { document: AtsDocumentScore }) {
  return (
    <li className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0" aria-label={document.label}>
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{document.label}</span><ScoreOnlyBadge match={document} /></div>
      <Terms title="Missing" terms={requiredFirst(document.missing)} />
      <Terms title="Covered" terms={requiredFirst(document.matched)} />
    </li>
  )
}

/** Each resume's keyword coverage of a job, with covered and missing terms, in the job details. */
export function ResumeMatchDetail({ jobId }: { jobId: unknown }) {
  const scores = useAtsJob(jobId)
  const documents = Array.isArray(scores.data?.documents) ? scores.data.documents : []
  if (!documents.length) return null
  return (
    <section aria-label="Resume match" className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">{ATS_TITLE}</p>
      <ul className="space-y-2">{documents.map(document => <DocumentMatch key={document.document_key} document={document} />)}</ul>
      <p className="text-xs text-muted-foreground">{ATS_NOTE} Triage measures fit with your whole profile; this measures what the resume you send covers.</p>
    </section>
  )
}
