import { useState, type SetStateAction } from "react"

// Search output stays in memory for navigation, never in the URL or disk.
const sessions = new Map<string, unknown>()
export function cacheSearchResult(result: unknown) {
  const id = crypto.randomUUID()
  sessions.set(id, result)
  return id
}
export function searchResult(id?: string) { return id ? sessions.get(id) : undefined }
export function useSearchSession<T>(key: string | undefined, initial: T) {
  const [local, setLocal] = useState(initial)
  const value = key && sessions.has(key) ? sessions.get(key) as T : initial
  return [key ? value : local, (change: SetStateAction<T>) => {
    const next = typeof change === "function" ? (change as (old: T) => T)(key ? value : local) : change
    if (key) sessions.set(key, next)
    setLocal(next)
  }] as const
}
