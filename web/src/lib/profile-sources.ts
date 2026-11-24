import { useEffect } from "react"
import { request, subscribe, useApi } from "./api"
import type { ChoiceSource, ProfileAssetState, ProfileConflict, ProfileSourcesState } from "../../../src/profile/types"
export type { ChoiceSource, LinkedInExperience, ProfileAssetState, ProfileConflict, ProfileSourcesState } from "../../../src/profile/types"

export const PROFILE_SOURCES_PATH = "profile-sources"
export const KIND_LABELS: Record<NonNullable<ProfileAssetState["kind"]> | "pending", string> = { data: "Data file", linkedin: "LinkedIn export", reference: "Reference resume", pending: "PDF" }
export const STATUS_LABELS: Record<ProfileAssetState["status"], string> = { imported: "Imported", pending: "Not imported yet", failed: "Could not be read" }

/** The profile folder's state; it also refreshes when the resume sources are saved. */
export function useProfileSources() {
  const api = useApi<ProfileSourcesState>(PROFILE_SOURCES_PATH)
  const { refresh } = api
  useEffect(() => subscribe(event => { if (event.type === "resume-sources-changed") refresh() }), [refresh])
  return api
}
/** Conflicts still waiting for a choice; tolerant of a state that has not loaded. */
export function undecidedConflicts(state?: Partial<ProfileSourcesState>): ProfileConflict[] {
  return Array.isArray(state?.conflicts) ? state.conflicts.filter(conflict => !conflict.chosen) : []
}
export const importAgain = () => request<ProfileSourcesState>("profile-sources/import", { force: true })
/** `null` forgets the decision ("Decide later"). */
export const chooseSource = (key: string, source: ChoiceSource | null) => request<ProfileSourcesState>("profile-sources/choice", { key, source })
