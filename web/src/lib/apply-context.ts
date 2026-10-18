import { useWorkspaceState } from "./workspace-state"
import { useContextDraft } from "./context-draft"
import type { PreparationRun } from "./preparation"

export function useApplyContext(search: { jobId?: number; applicationId?: number }, savedDescription?: string | null, runs: PreparationRun[] = []) {
  const { search: route, update } = useWorkspaceState("apply")
  const scope = `apply:job:${search.jobId ?? "none"}:application:`
  const jobContext = useContextDraft(`${scope}job`)
  const generated = runs.find(run => run.id === jobContext.draft.runId)
  const applicationId = search.applicationId ?? generated?.application_id
  // Adopt only the application created by this draft's own generation run.
  const seed = applicationId && generated?.application_id === applicationId ? jobContext.draft : undefined
  const applicationContext = useContextDraft(`${scope}${applicationId ?? "none"}`, seed)
  const context = applicationId ? applicationContext : jobContext
  const provider = route.provider ?? localStorage.getItem("work-tracker-provider") ?? ""
  const model = route.model ?? localStorage.getItem("work-tracker-model") ?? ""
  const setProvider = (provider: string) => update({ provider })
  const setModel = (model: string) => update({ model })
  const extra = context.draft.extra
  const descriptionDirty = !!context.draft.descriptionDirty
  const description = descriptionDirty ? context.draft.description ?? "" : savedDescription ?? ""
  const setExtra = (extra: string) => context.update(previous => ({ ...previous, extra }))
  const setDescription = (description: string) => context.update(previous => ({ ...previous, description, descriptionDirty: true }))
  return { route, update, context, provider, model, setProvider, setModel, extra, descriptionDirty, description, setExtra, setDescription }
}
