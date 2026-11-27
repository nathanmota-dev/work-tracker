import { useState, type SetStateAction } from "react"

export type ContextDraft = { extra: string; description?: string; descriptionDirty?: boolean; runId?: string; resume?: ResumePick }
/** A resume chosen in Apply, valid while the application still shows the resume of `runId`. */
export type ResumePick = { choice: string; runId?: string }
const empty: ContextDraft = { extra: "" }
function read(key: string, seed?: ContextDraft) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null && seed) {
      try { localStorage.setItem(key, JSON.stringify(seed)); return { draft: seed, error: "", hasValue: true } }
      catch { return { draft: seed, error: "Could not save this context draft. Keep this page open and try editing again.", hasValue: true } }
    }
    const value = JSON.parse(raw ?? "null")
    return { draft: value && typeof value.extra === "string" ? {
      extra: value.extra, description: typeof value.description === "string" ? value.description : undefined, descriptionDirty: value.descriptionDirty === true,
      ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
      ...(typeof value.resume?.choice === "string" ? { resume: value.resume as ResumePick } : {}),
    } as ContextDraft : empty, error: "", hasValue: raw !== null }
  } catch { return { draft: empty, error: "Could not restore this context draft.", hasValue: true } }
}

/** Write synchronously on editing so leaving or closing cannot race a debounce. */
export function useContextDraft(scope: string, seed?: ContextDraft) {
  const key = `work-tracker-context-v1:${scope}`
  const [state, setState] = useState(() => ({ key, ...read(key, seed) }))
  const reload = state.key !== key || !state.hasValue && !!seed
  const current = reload ? { key, ...read(key, seed) } : state
  if (reload) setState(current)
  function update(change: SetStateAction<ContextDraft>) {
    const draft = typeof change === "function" ? change(current.draft) : change
    let error = ""
    try { localStorage.setItem(key, JSON.stringify(draft)) }
    catch { error = "Could not save this context draft. Keep this page open and try editing again." }
    setState({ key, draft, error, hasValue: true })
  }
  return { draft: current.draft, update, error: current.error }
}
