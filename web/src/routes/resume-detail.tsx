import { lazy, Suspense, useState } from "react"
import { useSearch } from "@tanstack/react-router"
import { BackButton } from "@/components/back-button"
import { Empty, LoadState, Page, Panel } from "@/components/workspace-ui"
import { ResumeVariantCard } from "@/components/resume-variant-card"
import { ResumeVariantForm } from "@/components/resume-variant-form"
import { useApi } from "@/lib/api"
import type { ResumeVariant } from "@/lib/variants"
const PdfViewer = lazy(() => import("@/components/pdf-viewer").then(module => ({ default: module.PdfViewer })))

const back = <BackButton href="#/resumes" label="Back to Resumes" />

/**
 * One saved resume, opened from its card in Resumes: its details and actions,
 * and its PDF filling the visible height. Archived ones still open.
 */
export function ResumeDetailPage() {
  const { id } = useSearch({ strict: false }) as { id?: string }
  const variants = useApi<ResumeVariant[]>("resume-variants?archived=true")
  const [editing, setEditing] = useState(false)
  const list = Array.isArray(variants.data) ? variants.data : []
  const variant = list.find(item => item.id === id)
  const busy = list.some(item => item.status === "generating")
  if (!variant) return <Page title="Resume" back={back}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {variants.data && <Panel title="Saved resume"><Empty title="Saved resume not found" description="It may have been removed. Go back to Resumes to choose another one." /></Panel>}
  </Page>
  // From xl up, both columns share the visible height: the details scroll on their own and the PDF fills the rest.
  return <Page title={variant.name} back={back} fill>
    <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(18rem,24rem)_1fr]">
      <ResumeVariantCard variant={variant} busy={busy} onEdit={() => setEditing(true)} className="xl:min-h-0 xl:overflow-y-auto" />
      <div className="flex h-[85dvh] min-h-0 flex-col xl:h-auto">
        {variant.pdf
          ? <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfViewer title={`${variant.name} PDF`} artifact={variant.pdf} fill /></Suspense>
          : <Panel title="PDF"><Empty title="No PDF yet" description="The PDF appears here once the resume is ready." /></Panel>}
      </div>
    </div>
    {editing && <ResumeVariantForm mode="edit" variant={variant} onClose={() => { setEditing(false); variants.refresh() }} />}
  </Page>
}
