import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Field, controlClass } from "@/components/workspace-ui"
import { ScoreOnlyBadge } from "@/components/resume-match-detail"
import { request } from "@/lib/api"
import { ATS_NOTE, ATS_TITLE, byJobScore, useAtsJob, type AtsDocumentScore } from "@/lib/ats"
import { readyVariants, roleLabels, useVariants, variantLabel } from "@/lib/variants"

type UsedRun = { id: string; application_id: number | null }
const MAX_MISSING = 5

/** "Missing required: C#, .NET" for up to five required terms the resume lacks. */
function MissingRequired({ score }: { score: AtsDocumentScore | undefined }) {
  const missing = score?.requiredMissing.slice(0, MAX_MISSING) ?? []
  return missing.length ? <p className="text-xs text-muted-foreground">Missing required: {missing.join(", ")}</p> : null
}

/** "Tailored: 85 · Best saved: 72" once the job has a tailored resume. */
function TailoredComparison({ scores }: { scores: AtsDocumentScore[] }) {
  const tailored = scores.find(item => item.kind === "document")
  const saved = scores.find(item => item.kind !== "document")
  if (!tailored) return null
  const value = (item: AtsDocumentScore) => item.score ?? "—"
  return <p className="text-xs" title={ATS_NOTE}>Tailored: {value(tailored)}{saved ? ` · Best saved: ${value(saved)}` : ""}</p>
}

/** Choose a ready saved resume for this job; the best keyword match comes first and is preselected. */
export function SavedResumePicker({ disabled, target, onUsed, onError }: { disabled: boolean; target: { jobId?: number; applicationId?: number }; onUsed: (run: UsedRun) => void; onError: (message: string) => void }) {
  const variants = useVariants()
  const ats = useAtsJob(target.jobId)
  const scores = Array.isArray(ats.data?.documents) ? ats.data.documents : []
  const ready = byJobScore(readyVariants(variants.data), scores)
  const [selected, setSelected] = useState("")
  const [pending, setPending] = useState(false)
  async function use(variantId: string) {
    setPending(true); onError("")
    try { onUsed(await request<UsedRun>("application-preparation/use-variant", { ...target, variantId })) }
    catch (e) { onError((e as Error).message) }
    finally { setPending(false) }
  }
  const value = ready.some(variant => variant.id === selected) ? selected : ready[0]?.id ?? ""
  const score = scores.find(item => item.variant_id === value)
  const base = scores.find(item => item.kind === "base")
  if (variants.loading && !variants.data) return null
  if (!ready.length) return <div className="space-y-1">
    {base && <p className="flex flex-wrap items-center gap-2 text-xs" aria-label={ATS_TITLE}>Base resume: <ScoreOnlyBadge match={base} /> Generate tailored resume to cover the missing terms.</p>}
    <MissingRequired score={base} />
    <TailoredComparison scores={scores} />
    <p className="text-xs text-muted-foreground">No saved resume is ready. <a className="text-foreground underline" href="#/resumes">Create one in Resumes</a> to reuse it for jobs with the same stack.</p>
  </div>
  return <div className="space-y-1">
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1"><Field label="Saved resume"><SelectControl className={controlClass} value={value} disabled={disabled || pending} onChange={event => setSelected(event.target.value)}>
        {ready.map(variant => {
          const match = scores.find(item => item.variant_id === variant.id)
          return <option key={variant.id} value={variant.id}>{variantLabel(variant)}{variant.name !== `${roleLabels[variant.role]} · ${variant.stacks.join(", ")}` ? ` (${variant.name})` : ""}{typeof match?.score === "number" ? ` · ${match.score}` : ""}</option>
        })}
      </SelectControl></Field></div>
      {score && <span aria-label={ATS_TITLE} className="pb-2"><ScoreOnlyBadge match={score} /></span>}
      <Button variant="outline" disabled={disabled || pending || !value} onClick={() => void use(value)}>Use this resume</Button>
    </div>
    <MissingRequired score={score} />
    <TailoredComparison scores={scores} />
  </div>
}
