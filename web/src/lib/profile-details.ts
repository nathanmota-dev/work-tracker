import { request, type Row } from "./api"
import type { PersonalSource, ProfileSourcesState } from "../../../src/profile/types"

export const SOURCE_LABELS: Record<PersonalSource, string> = { data: "From your data file", linkedin: "From LinkedIn", resume: "From your resume PDF" }

/** Sections of the profile, in order; `manual` fields never come from a resume. */
export const PROFILE_SECTIONS: { title: string; keys: string[]; manual?: boolean }[] = [
  { title: "Personal information", keys: ["first_name", "last_name", "full_name", "email", "phone", "birth_date"] },
  { title: "Address", keys: ["location", "country", "state", "city", "neighborhood", "address", "postal_code"] },
  { title: "Professional profile", keys: ["desired_role", "preferred_locations", "experience_level", "professional_category", "summary", "languages", "salary_expectation"] },
  { title: "Links", keys: ["linkedin_url", "github_url", "portfolio_url", "social_links"] },
  { title: "Needs your answer", keys: ["work_authorization", "requires_sponsorship", "notice_period", "accepts_clt"], manual: true },
]

export interface ProfileValue { value: string; origin: string }
/** The saved default answer of a field and where it came from; "" when missing. */
export function profileValue(rows: Row[], key: string): ProfileValue {
  const row = rows.find(item => item.key === key && (item.language ?? "default") === "default")
  const value = typeof row?.value === "string" ? row.value.trim() : ""
  if (!value) return { value: "", origin: "" }
  const source = row?.autofill_source as PersonalSource | null | undefined
  return { value, origin: source && SOURCE_LABELS[source] ? SOURCE_LABELS[source] : "Added by you" }
}

let synced = false
/**
 * Import new PDFs of the profile folder and fill empty answers from the
 * sources, once per app session; the Profile page calls it when it opens.
 */
export function syncProfileOnce(): Promise<ProfileSourcesState | null> {
  if (synced) return Promise.resolve(null)
  synced = true
  return request<ProfileSourcesState>("profile-sources/import", {}).catch(() => { synced = false; return null })
}
/** Tests reset the once-per-session guard. */
export function resetProfileSync() { synced = false }
