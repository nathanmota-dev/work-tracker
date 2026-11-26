import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/workspace-ui"
import { boardAction } from "@/lib/application-board"

const isLinkedInPosting = (url: string) => /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/jobs\//i.test(url)

/**
 * The form the agent fills. A LinkedIn posting is resolved to the employer's
 * link behind its Apply button when filling; the candidate can paste the link
 * instead, for example one the posting gives in its description.
 */
export function PortalLink({ applicationId, url, disabled, onSaved }: { applicationId?: number; url: string | null | undefined; disabled: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const value = draft ?? url ?? ""
  const changed = draft !== undefined && draft.trim() !== (url ?? "")
  async function save() {
    setPending(true); setError("")
    try { await boardAction("portal-link", { id: applicationId!, external_url: value.trim() }); setDraft(undefined); onSaved() }
    catch (e) { setError((e as Error).message) }
    finally { setPending(false) }
  }
  if (!applicationId) return null
  return <div className="space-y-2">
    <Field label="Application link">
      <div className="flex gap-2">
        <Input type="url" value={value} disabled={disabled || pending} onChange={e => setDraft(e.target.value)} placeholder="https://employer.example/apply" />
        <Button variant="outline" disabled={disabled || pending || !changed || !value.trim()} onClick={() => void save()}>Save link</Button>
      </div>
    </Field>
    <p className="text-xs text-muted-foreground">{url && isLinkedInPosting(url)
      ? "This is the LinkedIn posting. When filling, Work Tracker follows its Apply button to the employer's form. If the posting is closed or gives its form elsewhere, paste that link here."
      : "The agent fills the form at this link."}</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
