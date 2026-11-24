import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Field, controlClass } from "@/components/workspace-ui"
import { request } from "@/lib/api"
import { readyVariants, roleLabels, useVariants, variantLabel } from "@/lib/variants"

type UsedRun = { id: string; application_id: number | null }
/** Choose a ready saved resume for this job; using it skips tailoring and opens review. */
export function SavedResumePicker({ disabled, target, onUsed, onError }: { disabled: boolean; target: { jobId?: number; applicationId?: number }; onUsed: (run: UsedRun) => void; onError: (message: string) => void }) {
  const variants = useVariants()
  const ready = readyVariants(variants.data)
  const [selected, setSelected] = useState("")
  const [pending, setPending] = useState(false)
  async function use(variantId: string) {
    setPending(true); onError("")
    try { onUsed(await request<UsedRun>("application-preparation/use-variant", { ...target, variantId })) }
    catch (e) { onError((e as Error).message) }
    finally { setPending(false) }
  }
  const value = ready.some(variant => variant.id === selected) ? selected : ready[0]?.id ?? ""
  if (variants.loading && !variants.data) return null
  if (!ready.length) return <p className="text-xs text-muted-foreground">No saved resume is ready. <a className="text-foreground underline" href="#/resumes">Create one in Resumes</a> to reuse it for jobs with the same stack.</p>
  return <div className="flex flex-wrap items-end gap-2">
    <div className="min-w-64 flex-1"><Field label="Saved resume"><SelectControl className={controlClass} value={value} disabled={disabled || pending} onChange={event => setSelected(event.target.value)}>
      {ready.map(variant => <option key={variant.id} value={variant.id}>{variantLabel(variant)}{variant.name !== `${roleLabels[variant.role]} · ${variant.stacks.join(", ")}` ? ` (${variant.name})` : ""}</option>)}
    </SelectControl></Field></div>
    <Button variant="outline" disabled={disabled || pending || !value} onClick={() => void use(value)}>Use this resume</Button>
  </div>
}
