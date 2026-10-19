import { useState } from "react"
export type { FillChecklistItem, FillReview } from "../../../src/preparation/types"

/** Answers opens the field's editor and offers a way back to this Apply view. */
export function answerCorrectionHref(field: string, hash = window.location.hash): string {
  const current = hash.replace(/^#/, "")
  const params = new URLSearchParams({ field, ...(current.startsWith("/apply") ? { returnTo: current } : {}) })
  return `#/answers?${params}`
}

function read(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch { return [] }
}

/**
 * Pending fields the candidate marked as handled in the portal, per fill result.
 * A per-viewer convenience: it never changes the fill or the submission.
 */
export function useReviewedFields(scope: string) {
  const key = `work-tracker-fill-review-v1:${scope}`
  const [state, setState] = useState(() => ({ key, items: read(key) }))
  const current = state.key === key ? state : { key, items: read(key) }
  if (current !== state) setState(current)
  function toggle(item: string, reviewed: boolean) {
    const items = reviewed ? [...new Set([...current.items, item])] : current.items.filter(entry => entry !== item)
    try { localStorage.setItem(key, JSON.stringify(items)) } catch { /* kept for this page only */ }
    setState({ key, items })
  }
  return { reviewed: new Set(current.items), toggle }
}
