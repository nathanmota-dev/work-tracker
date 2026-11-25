import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LoadState, Page } from "@/components/workspace-ui"
import { ResumeTile } from "@/components/resume-tile"
import { BaseResumeTile } from "@/components/base-resume"
import { ResumeVariantForm, type VariantFormMode } from "@/components/resume-variant-form"
import { roleOrder, useVariants } from "@/lib/variants"

/** Saved resumes: generated per role and stacks, imported, or saved when a tailored resume is approved in Apply. */
export function ResumesPage() {
  const variants = useVariants()
  const [form, setForm] = useState<VariantFormMode>()
  const list = Array.isArray(variants.data) ? variants.data : []
  const busy = list.some(variant => variant.status === "generating")
  return <Page title="Resumes" description="Your base resume and the resumes tailored from it for a role and stack, reused for every job that matches. Approving a tailored resume in Apply saves it here too." actions={<>
    <Button disabled={busy} onClick={() => setForm("generate")}>New resume</Button>
    <Button variant="outline" onClick={() => setForm("import")}>Import PDF</Button>
  </>}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {/* One grid: the base resume is always first, then the tailored ones in role order. */}
    <ul aria-label="Saved resumes" className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
      <li className="flex"><BaseResumeTile /></li>
      {roleOrder.flatMap(role => list.filter(variant => variant.role === role)).map(variant => <li key={variant.id} className="flex"><ResumeTile variant={variant} /></li>)}
    </ul>
    {variants.data && !list.length && <p className="text-sm text-muted-foreground">Generate a resume once for a role and its stacks, such as Back-End · C#, .NET, and reuse it in Apply for every job with the same stack. You can also import a PDF you already have, or approve a tailored resume in Apply.</p>}
    {form && <ResumeVariantForm mode={form} onClose={() => { setForm(undefined); variants.refresh() }} />}
  </Page>
}
