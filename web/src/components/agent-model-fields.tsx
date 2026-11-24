import { SelectControl } from "@/components/ui/select-control"
import { Field, controlClass } from "@/components/workspace-ui"
import type { Provider } from "@/lib/agent"

/** The agent and model selector shared by Apply and the saved-resume form. */
export function AgentModelFields({ providers, provider, model, disabled, onProvider, onModel }: {
  providers: Provider[]
  provider?: Provider
  model: string
  disabled: boolean
  onProvider: (id: string) => void
  onModel: (model: string) => void
}) {
  return <div className="grid gap-4 md:grid-cols-2">
    <Field label="Agent"><SelectControl className={controlClass} value={provider?.id ?? ""} disabled={disabled} onChange={e => onProvider(e.target.value)}>{providers.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</SelectControl></Field>
    <Field label="Model"><SelectControl className={controlClass} value={model} disabled={disabled} onChange={e => onModel(e.target.value)}><option value="">Provider default</option>{provider?.models.map(m => <option key={m}>{m}</option>)}</SelectControl></Field>
  </div>
}
