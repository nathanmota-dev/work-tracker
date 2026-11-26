import { useState } from "react"
import { useApi } from "./api"
import { supportedEffort, type Providers } from "./agent"

const read = (key: string) => { try { return localStorage.getItem(key) ?? "" } catch { return "" } }

/** The agent, model and effort saved in Agent › Setup, falling back to the workspace default; a run may override them. */
export function useDefaultAgent() {
  const api = useApi<Providers>("acp/providers")
  const [provider, setProvider] = useState(() => read("work-tracker-provider"))
  const [model, setModel] = useState(() => read("work-tracker-model"))
  const [effort, setEffort] = useState(() => read("work-tracker-effort"))
  const selectedProvider = api.data?.providers.find(item => item.id === provider) ?? api.data?.providers.find(item => item.id === api.data?.default) ?? api.data?.providers[0]
  return {
    api, selectedProvider,
    effectiveModel: selectedProvider?.models.includes(model) ? model : "",
    effectiveEffort: supportedEffort(selectedProvider, effort),
    setProvider: (value: string) => { setProvider(value); setModel(""); setEffort("") },
    setModel, setEffort,
  }
}
