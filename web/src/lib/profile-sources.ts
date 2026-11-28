import { useEffect } from "react"
import { request, subscribe, useApi } from "./api"
import type { ProfileAssetState, ProfileSourcesState, UploadResult } from "../../../src/profile/types"
export type { ProfileAssetState, ProfileSourcesState, UploadResult } from "../../../src/profile/types"

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
export const importAgain = () => request<ProfileSourcesState>("profile-sources/import", { force: true })

/** Files the upload accepts: resume and LinkedIn PDFs, and the resume data file. */
export const UPLOAD_ACCEPT = ".pdf,.json,application/pdf,application/json"
function base64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1))
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."))
    reader.readAsDataURL(file)
  })
}
/** Copy one file into the profile folder; `replace` confirms replacing the file the profile is built from. */
export async function uploadProfileFile(file: File, replace = false) {
  return request<ProfileSourcesState & { upload: UploadResult }>("profile-sources/upload", { name: file.name, base64: await base64(file), ...(replace && { replace: true }) })
}
