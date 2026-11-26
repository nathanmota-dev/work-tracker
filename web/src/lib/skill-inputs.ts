import { useCallback, useSyncExternalStore } from "react"
import { publish, request, useApi, type Row } from "./api"

/** Inputs a skill keeps between runs; job IDs and URLs come from the screen that opens it. */
export const persistedSkillFields = ["query", "location", "company", "username", "extra", "workType", "maxPages"] as const
export type SkillInputField = (typeof persistedSkillFields)[number]
export type SkillInputs = Partial<Record<SkillInputField, string>>

/** What each skill keeps; skills about one record (a job, an application) take everything from the screen that opens them. */
const SAVED_FIELDS: Partial<Record<string, readonly SkillInputField[]>> = {
  "job-scout": ["query", "location", "extra"],
  "recruiter-outreach": ["company", "location", "extra"],
  "profile-optimizer": ["username", "extra"],
  "outreach-tracker": ["extra"],
  "experience-bank": ["extra"],
}
export const savedSkillFields = (skill: string): readonly SkillInputField[] => SAVED_FIELDS[skill] ?? []

/** A job search's role and location are the Profile's desired roles and preferred locations: one value for both screens. */
const PROFILE_FIELDS: Partial<Record<string, Partial<Record<SkillInputField, string>>>> = {
  "job-scout": { query: "desired_role", location: "preferred_locations" },
}

const storageKey = (skill: string) => `work-tracker-skill-inputs-v1:${skill}`
const cache = new Map<string, SkillInputs>()
const listeners = new Set<() => void>()
/** Profile edits not yet visible in the answers, so typing never jumps back to the saved value. */
const pending = new Map<string, string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clean(value: unknown): SkillInputs {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(persistedSkillFields.flatMap(field => {
    const item = (value as Record<string, unknown>)[field]
    return typeof item === "string" ? [[field, item]] : []
  }))
}

function parse(raw: string | null) {
  try { return raw === null ? undefined : clean(JSON.parse(raw)) } catch { return undefined }
}

/** What the Agent console saved before inputs moved to each skill's screen. */
function legacyInputs(skill: string): SkillInputs {
  try {
    const fields = parse(localStorage.getItem(`work-tracker-launch-fields-v1:${skill}`)) ?? {}
    const context = parse(localStorage.getItem(`work-tracker-context-v1:launch:${skill}:`))
    return { ...(fields.query && { query: fields.query }), ...(fields.location && { location: fields.location }), ...(context?.extra && { extra: context.extra }) }
  } catch { return {} }
}

/** The saved inputs of a skill, migrated once from the console's storage. */
export function readSkillInputs(skill: string): SkillInputs {
  const cached = cache.get(skill)
  if (cached) return cached
  let value: SkillInputs
  try { value = parse(localStorage.getItem(storageKey(skill))) ?? legacyInputs(skill) }
  catch { value = {} }
  cache.set(skill, value)
  return value
}

/** Written synchronously so leaving the screen or closing the app cannot lose an edit. */
export function writeSkillInputs(skill: string, change: SkillInputs) {
  const next = { ...readSkillInputs(skill), ...clean(change) }
  cache.set(skill, next)
  try { localStorage.setItem(storageKey(skill), JSON.stringify(next)) } catch { /* the inputs stay for this session */ }
  for (const listener of listeners) listener()
}

/** Only for tests: forget what this session read. */
export function resetSkillInputsCache() {
  cache.clear(); pending.clear()
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function saveProfileAnswer(id: string, answerKey: string, value: string) {
  pending.set(id, value)
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    void request("answer", { key: answerKey, value: value.trim(), category: "profile" })
      .then(() => publish({ type: "changed", table: "applicant_answers" }))
      .catch(() => pending.delete(id))
  }, 600))
}

/** A skill's saved inputs and a setter that keeps them for the next run. */
export function useSkillInputs(skill: string) {
  const stored = useSyncExternalStore(subscribe, () => readSkillInputs(skill))
  const shared = PROFILE_FIELDS[skill] ?? {}
  const answers = useApi<Row[]>("answers")
  const answer = (key: string) => String(answers.data?.find(row => row.key === key && (row.language ?? "default") === "default")?.value ?? "")
  const inputs: SkillInputs = { ...stored }
  for (const [field, answerKey] of Object.entries(shared)) {
    const id = `${skill}:${field}`
    const saved = answer(answerKey)
    if (pending.get(id)?.trim() === saved) pending.delete(id)
    const value = pending.get(id) ?? (saved || stored[field as SkillInputField])
    if (value) inputs[field as SkillInputField] = value
  }
  const setInputs = useCallback((change: SkillInputs) => {
    writeSkillInputs(skill, change)
    for (const [field, answerKey] of Object.entries(PROFILE_FIELDS[skill] ?? {}))
      if (field in change) saveProfileAnswer(`${skill}:${field}`, answerKey!, change[field as SkillInputField] ?? "")
  }, [skill])
  return { inputs, setInputs }
}
