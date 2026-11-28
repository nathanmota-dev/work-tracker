import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SelectControl } from "@/components/ui/select-control"
import { FormDialog, useSubmit } from "@/components/form-dialog"
import { AgentModelFields } from "@/components/agent-model-fields"
import { TagField, parseTags, serializeTags } from "@/components/tag-field"
import { Field, controlClass } from "@/components/workspace-ui"
import { useApi } from "@/lib/api"
import type { Providers } from "@/lib/agent"
import { languageLabels, roleLabels, roleOrder, stackSuggestions, variantAction, type ResumeVariant, type VariantLanguage, type VariantRole } from "@/lib/variants"

export type VariantFormMode = "generate" | "edit" | "import"
const copy: Record<VariantFormMode, { title: string; description: string; submit: string }> = {
  generate: { title: "New resume", description: "Generate one resume for a role and its stacks, then reuse it for every job with the same profile.", submit: "Generate resume" },
  edit: { title: "Edit details", description: "Rename or re-tag this resume. To change its content, open it and edit its LaTeX.", submit: "Save changes" },
  import: { title: "Import PDF", description: "Use a resume PDF you already have. It is checked for pages and extractable text.", submit: "Import resume" },
}

/** Create, edit or import a saved resume. */
export function ResumeVariantForm({ mode, variant, onClose }: { mode: VariantFormMode; variant?: ResumeVariant; onClose: () => void }) {
  const providers = useApi<Providers>("acp/providers")
  const [name, setName] = useState(variant?.name ?? "")
  const [role, setRole] = useState<VariantRole>(variant?.role ?? "backend")
  const [stacks, setStacks] = useState(serializeTags(variant?.stacks ?? []))
  const [focus, setFocus] = useState("")
  const [language, setLanguage] = useState<VariantLanguage>("auto")
  const [providerId, setProviderId] = useState("")
  const [model, setModel] = useState("")
  const [path, setPath] = useState("")
  const { busy, error, submit } = useSubmit()
  const list = providers.data?.providers ?? []
  const provider = list.find(p => p.id === providerId) ?? list.find(p => p.id === providers.data?.default) ?? list[0]
  const tags = parseTags(stacks)
  const suggested = `${roleLabels[role]} · ${tags.join(", ")}`
  const ready = tags.length > 0 && (mode !== "import" || !!path) && (mode !== "generate" || !!provider)
  async function choose() {
    const selected = await window.desktop?.chooseSource("pdf")
    if (selected) setPath(selected)
  }
  const save = () => submit(async () => {
    const profile = { name: name.trim() || suggested, role, stacks: tags }
    if (mode === "edit") await variantAction("update", { id: variant!.id, ...profile })
    else if (mode === "import") await variantAction("import", { ...profile, path })
    else await variantAction("generate", { ...profile, focus, language, provider: provider?.id, model: provider?.models.includes(model) ? model : undefined })
    onClose()
  })
  return <FormDialog title={copy[mode].title} description={copy[mode].description} busy={busy} error={error || providers.error} submitLabel={copy[mode].submit} canSubmit={ready} onClose={onClose} onSubmit={() => void save()}>
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Role"><SelectControl className={controlClass} value={role} disabled={busy} onChange={e => setRole(e.target.value as VariantRole)}>{roleOrder.map(item => <option key={item} value={item}>{roleLabels[item]}</option>)}</SelectControl></Field>
      <Field label="Name"><Input value={name} maxLength={80} disabled={busy} placeholder={suggested} onChange={e => setName(e.target.value)} /></Field>
    </div>
    <TagField label="Stacks" value={stacks} onChange={setStacks} suggestions={stackSuggestions} placeholder="C#, .NET, React…" disabled={busy} required />
    {mode === "generate" && <>
      <Field label="Focus"><Textarea value={focus} maxLength={1000} disabled={busy} placeholder="Optional: what the agent should emphasize, such as APIs or cloud work." onChange={e => setFocus(e.target.value)} /></Field>
      <Field label="Language"><SelectControl className={controlClass} value={language} disabled={busy} onChange={e => setLanguage(e.target.value as VariantLanguage)}>{(Object.keys(languageLabels) as VariantLanguage[]).map(item => <option key={item} value={item}>{languageLabels[item]}</option>)}</SelectControl></Field>
      <AgentModelFields providers={list} provider={provider} model={provider?.models.includes(model) ? model : ""} disabled={busy} onProvider={id => { setProviderId(id); setModel("") }} onModel={setModel} />
    </>}
    {mode === "import" && <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void choose()}>Choose PDF</Button>
      <span className="min-w-0 break-all text-xs text-muted-foreground">{path || "No file selected"}</span>
    </div>}
  </FormDialog>
}
