import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Empty, LoadState, Page, Panel } from "@/components/workspace-ui"
import { ResumeVariantCard } from "@/components/resume-variant-card"
import { ResumeVariantForm, type VariantFormMode } from "@/components/resume-variant-form"
import { roleLabels, roleOrder, useVariants, type ResumeVariant } from "@/lib/variants"

/** Saved resumes: generated once per role and stacks, reused across applications. */
export function ResumesPage() {
  const variants = useVariants()
  const [form, setForm] = useState<{ mode: VariantFormMode; variant?: ResumeVariant }>()
  const list = variants.data ?? []
  const busy = list.some(variant => variant.status === "generating")
  return <Page title="Resumes" description="Resumes for a role and stack, generated once and reused for every job that matches." actions={<>
    <Button disabled={busy} onClick={() => setForm({ mode: "generate" })}>New resume</Button>
    <Button variant="outline" onClick={() => setForm({ mode: "import" })}>Import PDF</Button>
  </>}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {variants.data && !list.length && <Panel title="Saved resumes"><Empty title="No saved resumes yet" description="Generate a resume once for a role and its stacks, such as Back-End · C#, .NET, and reuse it in Apply for every job with the same stack. You can also import a PDF you already have." /></Panel>}
    {roleOrder.map(role => {
      const items = list.filter(variant => variant.role === role)
      return items.length ? <Panel key={role} title={roleLabels[role]}><div className="grid gap-3 lg:grid-cols-2">{items.map(variant => <ResumeVariantCard key={variant.id} variant={variant} busy={busy} onEdit={() => setForm({ mode: "edit", variant })} />)}</div></Panel> : null
    })}
    {form && <ResumeVariantForm mode={form.mode} variant={form.variant} onClose={() => { setForm(undefined); variants.refresh() }} />}
  </Page>
}
