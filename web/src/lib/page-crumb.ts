import { useEffect, useSyncExternalStore } from "react"

// A detail page names its record in the breadcrumb, e.g. "Company · Role".
let current = ""
const listeners = new Set<() => void>()
function set(value: string) {
  current = value
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePageCrumb(label: string) {
  useEffect(() => {
    set(label)
    return () => set("")
  }, [label])
}

export function useCurrentCrumb() {
  return useSyncExternalStore(subscribe, () => current)
}
