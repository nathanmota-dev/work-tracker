import { CircleHelp, ShieldCheck, TriangleAlert } from "lucide-react"

type GuardList = "instruction_like" | "invisible_text" | "homoglyph_runs" | "hidden_blocks" | "hidden_urls" | "tool_mentions"
/** The posting guard result stored with a job (`jobs.description_guard_json`). */
export type PostingGuard = {
  verdict: string
  flagged: boolean
  counts: Partial<Record<GuardList, number>>
  excerpts: Partial<Record<GuardList, string[]>>
}

const SECTIONS: [GuardList, string][] = [
  ["instruction_like", "Instruction-shaped lines"],
  ["invisible_text", "Text spelled in invisible characters"],
  ["homoglyph_runs", "Mixed-script words"],
  ["hidden_blocks", "Hidden blocks removed"],
  ["hidden_urls", "Hidden URLs removed"],
  ["tool_mentions", "Tool mentions"],
]

/** The stored guard result, or null when the job was never checked. */
export function parsePostingGuard(value: unknown): PostingGuard | null {
  if (typeof value !== "string" || !value) return null
  try {
    const guard = JSON.parse(value) as PostingGuard
    return guard && typeof guard.verdict === "string" ? { ...guard, counts: guard.counts ?? {}, excerpts: guard.excerpts ?? {} } : null
  } catch { return null }
}

/**
 * Posting check badge for a job description. Quoted excerpts are rendered as
 * plain text, never as markup, and the state is carried by the icon and the
 * words as well as the color.
 */
export function PostingCheck({ guard, description }: { guard: unknown; description: unknown }) {
  if (typeof description !== "string" || !description.trim()) return null
  const result = parsePostingGuard(guard)
  if (!result) return (
    <div role="status" aria-label="Posting check" className="flex gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
      <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p><span className="font-medium text-foreground">Posting check: Not checked.</span> This description was saved before the posting check existed. Save it again to check it.</p>
    </div>
  )
  const Icon = result.flagged ? TriangleAlert : ShieldCheck
  const sections = SECTIONS.filter(([key]) => (result.counts[key] ?? 0) > 0)
  return (
    <div role="status" aria-label="Posting check" className={`space-y-2 rounded-lg border p-3 text-sm ${result.flagged ? "border-amber-500/60 bg-amber-500/5" : ""}`}>
      <p className="flex gap-2">
        <Icon className={`mt-0.5 size-4 shrink-0 ${result.flagged ? "text-amber-600" : "text-emerald-600"}`} aria-hidden />
        <span className="font-medium">{result.verdict}</span>
      </p>
      {result.flagged && <p className="text-muted-foreground">Review these findings before an agent uses this job. Hidden content was removed from the saved description; quoted lines were kept.</p>}
      {sections.length > 0 && (
        <details open={result.flagged}>
          <summary className="cursor-pointer text-muted-foreground">Findings</summary>
          <dl className="mt-2 space-y-2">
            {sections.map(([key, label]) => {
              const items = result.excerpts[key] ?? []
              const more = (result.counts[key] ?? 0) - items.length
              return (
                <div key={key}>
                  <dt className="font-medium">{label} ({result.counts[key]})</dt>
                  <dd>
                    <ul className="mt-1 space-y-1">
                      {items.map((item, index) => <li key={index}><q className="break-words font-mono text-xs">{item}</q></li>)}
                      {more > 0 && <li className="text-xs text-muted-foreground">{more} more not shown</li>}
                    </ul>
                  </dd>
                </div>
              )
            })}
          </dl>
        </details>
      )}
    </div>
  )
}
