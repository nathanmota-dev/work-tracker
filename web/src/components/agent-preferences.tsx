import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { EffortSlider } from "@/components/ui/effort-slider"
import { Field, LoadState, Panel, controlClass } from "@/components/workspace-ui"
import { useApi } from "@/lib/api"
import type { Providers } from "@/lib/agent"

/** The agent, model and effort new runs use on this device; Apply and every skill read them. */
export function useAgentPreferences() {
  const api = useApi<Providers>("acp/providers")
  const [provider, setProvider] = useState(
    localStorage.getItem("work-tracker-provider") ?? "",
  )
  const [model, setModel] = useState(
    localStorage.getItem("work-tracker-model") ?? "",
  )
  const [effort, setEffort] = useState(
    localStorage.getItem("work-tracker-effort") ?? "",
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  return { api, provider, setProvider, model, setModel, effort, setEffort, saved, setSaved, error, setError }
}

export function AgentPreferences({ preferences }: { preferences: ReturnType<typeof useAgentPreferences> }) {
  const { api, provider, setProvider, model, setModel, effort, setEffort, saved, setSaved, error, setError } = preferences
  const selected = api.data?.providers.find((p) => p.id === provider)
  return (
    <Panel title="Agent preferences">
      <p className="mb-4 text-sm text-muted-foreground">
        Default selections for new runs on this device.
      </p>
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setSaved(false)
            if ((provider && !selected) || (model && !selected?.models.includes(model)) || (effort && !selected?.efforts?.includes(effort))) { setError("Choose an available agent, model and effort before saving preferences."); return }
            setError("")
            localStorage.setItem("work-tracker-provider", provider)
            localStorage.setItem("work-tracker-model", model)
            localStorage.setItem("work-tracker-effort", effort)
            setSaved(true)
          }}
        >
          <Field label="Preferred agent">
            <SelectControl
              className={controlClass}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value)
                setModel("")
                setEffort("")
                setSaved(false)
              }}
            >
              <option value="">
                Workspace default ({api.data.default})
              </option>
              {api.data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </SelectControl>
          </Field>
          <Field label="Preferred model">
            <SelectControl
              className={controlClass}
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setSaved(false)
              }}
            >
              <option value="">Provider default</option>
              {selected?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </SelectControl>
          </Field>
          {!!selected?.efforts?.length && <EffortSlider
            label="Preferred effort"
            levels={selected.efforts}
            value={effort}
            onChange={(level) => {
              setEffort(level)
              setSaved(false)
            }}
          />}
          <Button size="sm">Save preferences</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Preferences saved.
            </p>
          )}
        </form>
      )}
    </Panel>
  )
}
