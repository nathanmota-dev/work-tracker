import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LoadState, Page } from "@/components/workspace-ui"
import { ResumeTile, type ResumeTileAction } from "@/components/resume-tile"
import { BaseResumeTile } from "@/components/base-resume"
import { ResumeVariantForm, type VariantFormMode } from "@/components/resume-variant-form"
import { roleOrder, useVariants, variantAction, type ResumeVariant } from "@/lib/variants"

/** Dashed tile at the end of the grid that starts a new tailored resume. */
function NewResumeTile({ first, disabled, onClick }: { first: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" aria-label="New tailored resume" disabled={disabled} onClick={onClick}
    className="flex w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-4 text-center text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:bg-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
    <span className="grid size-10 place-items-center rounded-full border bg-background"><Plus className="size-4" /></span>
    <span className="text-sm font-medium text-foreground">New tailored resume</span>
    <span className="text-xs">{first ? "Generate one for a role and its stacks, such as Back-End · C#, .NET, and reuse it for every matching job." : "For another role or stack."}</span>
  </button>
}

/** Saved resumes: generated per role and stacks, imported, or saved when a tailored resume is approved in Apply. */
export function ResumesPage() {
  const variants = useVariants()
  const [form, setForm] = useState<VariantFormMode>()
  const [editing, setEditing] = useState<ResumeVariant>()
  const [error, setError] = useState("")
  const list = Array.isArray(variants.data) ? variants.data : []
  const busy = list.some(variant => variant.status === "generating")
  function act(action: ResumeTileAction, variant: ResumeVariant) {
    setError("")
    if (action === "edit") return setEditing(variant)
    variantAction("archive", { id: variant.id }).then(variants.refresh, (e: Error) => setError(e.message))
  }
  return <Page title="Resumes" description="Your base resume and the resumes tailored from it for a role and stack, reused for every job that matches. Approving a tailored resume in Apply saves it here too." actions={<>
    <Button disabled={busy} onClick={() => setForm("generate")}>New resume</Button>
    <Button variant="outline" onClick={() => setForm("import")}>Import PDF</Button>
  </>}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {/* One grid: the base resume is always first, then the tailored ones in role order. */}
    <ul aria-label="Saved resumes" className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
      <li className="flex"><BaseResumeTile /></li>
      {roleOrder.flatMap(role => list.filter(variant => variant.role === role)).map(variant => <li key={variant.id} className="flex"><ResumeTile variant={variant} onAction={act} /></li>)}
      {variants.data && <li className="flex"><NewResumeTile first={!list.length} disabled={busy} onClick={() => setForm("generate")} /></li>}
    </ul>
    {form && <ResumeVariantForm mode={form} onClose={() => { setForm(undefined); variants.refresh() }} />}
    {editing && <ResumeVariantForm mode="edit" variant={editing} onClose={() => { setEditing(undefined); variants.refresh() }} />}
  </Page>
}
