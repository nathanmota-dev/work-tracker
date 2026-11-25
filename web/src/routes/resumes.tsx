import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Empty, LoadState, Page, Panel } from "@/components/workspace-ui"
import { ResumeTile } from "@/components/resume-tile"
import { ResumeVariantForm, type VariantFormMode } from "@/components/resume-variant-form"
import { roleLabels, roleOrder, useVariants } from "@/lib/variants"

/** Saved resumes: generated per role and stacks, imported, or saved when a tailored resume is approved in Apply. */
export function ResumesPage() {
  const variants = useVariants()
  const [form, setForm] = useState<VariantFormMode>()
  const list = Array.isArray(variants.data) ? variants.data : []
  const busy = list.some(variant => variant.status === "generating")
  return <Page title="Resumes" description="Resumes for a role and stack, reused for every job that matches. Approving a tailored resume in Apply saves it here too." actions={<>
    <Button disabled={busy} onClick={() => setForm("generate")}>New resume</Button>
    <Button variant="outline" onClick={() => setForm("import")}>Import PDF</Button>
  </>}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {variants.data && !list.length && <Panel title="Saved resumes"><Empty title="No saved resumes yet" description="Generate a resume once for a role and its stacks, such as Back-End · C#, .NET, and reuse it in Apply for every job with the same stack. You can also import a PDF you already have, or approve a tailored resume in Apply." /></Panel>}
    {roleOrder.map(role => {
      const items = list.filter(variant => variant.role === role)
      return items.length ? <Panel key={role} title={roleLabels[role]}><div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">{items.map(variant => <ResumeTile key={variant.id} variant={variant} />)}</div></Panel> : null
    })}
    {form && <ResumeVariantForm mode={form} onClose={() => { setForm(undefined); variants.refresh() }} />}
  </Page>
}
