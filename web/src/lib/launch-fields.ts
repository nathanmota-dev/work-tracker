/** Search fields reused across runs: a candidate usually looks for the same role in the same place. */
export const rememberedLaunchFields = ["query", "location"] as const
type Remembered = Partial<Record<(typeof rememberedLaunchFields)[number], string>>

const key = (skill: string) => `work-tracker-launch-fields-v1:${skill}`

export function readLaunchFields(skill: string): Remembered {
  try {
    const value = JSON.parse(localStorage.getItem(key(skill)) ?? "null")
    if (!value || typeof value !== "object") return {}
    return Object.fromEntries(rememberedLaunchFields.flatMap(field =>
      typeof value[field] === "string" ? [[field, value[field]]] : []))
  } catch { return {} }
}

/** Written synchronously on editing, like context drafts, so closing the app cannot lose it. */
export function writeLaunchFields(skill: string, params: Record<string, string>) {
  const next = Object.fromEntries(rememberedLaunchFields.map(field => [field, params[field] ?? ""]))
  try { localStorage.setItem(key(skill), JSON.stringify(next)) } catch { /* storage is a convenience */ }
}
