import { useSearch } from "@tanstack/react-router"
import { BackButton } from "@/components/back-button"
import { Empty, LoadState, Page, Panel } from "@/components/workspace-ui"
import { ResumeWorkspace } from "@/components/resume-workspace"
import { useApi } from "@/lib/api"
import { BASE_RESUME_ID, BaseResumeDetail } from "@/components/base-resume"
import type { ResumeVariant } from "@/lib/variants"

const back = <BackButton href="#/resumes" label="Back to Resumes" />

/**
 * One saved resume, opened from its card in Resumes: its LaTeX editor and
 * details beside its PDF, filling the visible height. Archived ones still open.
 */
export function ResumeDetailPage() {
  const { id } = useSearch({ strict: false }) as { id?: string }
  if (id === BASE_RESUME_ID) return <Page title="Base resume" description="The default resume every tailored resume starts from. It never changes; tailoring creates a new variant." back={back} fill>
    <BaseResumeDetail />
  </Page>
  return <SavedResumeDetail id={id} />
}

function SavedResumeDetail({ id }: { id?: string }) {
  const variants = useApi<ResumeVariant[]>("resume-variants?archived=true")
  const list = Array.isArray(variants.data) ? variants.data : []
  const variant = list.find(item => item.id === id)
  const busy = list.some(item => item.status === "generating")
  if (!variant) return <Page title="Resume" back={back}>
    <LoadState loading={variants.loading && !variants.data} error={variants.error} retry={variants.refresh} />
    {variants.data && <Panel title="Saved resume"><Empty title="Saved resume not found" description="It may have been removed. Go back to Resumes to choose another one." /></Panel>}
  </Page>
  // Keyed by resume, so opening another one starts from its own files.
  return <ResumeWorkspace key={variant.id} variant={variant} busy={busy} back={back} />
}
