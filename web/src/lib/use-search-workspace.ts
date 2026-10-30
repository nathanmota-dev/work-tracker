import { useState, useRef, type SetStateAction } from "react"
import { useWorkspaceState } from "./workspace-state"
import { cacheSearchResult, searchResult, useSearchSession } from "./search-session"
import { request, type Row } from "./api"
import { structuredSearchRows } from "../../../src/jobs/search-results"
import type { SearchKind, SearchValues } from "@/components/search-results"

export function useSearchWorkspace() {
  const { search: route, update } = useWorkspaceState("search")
  const kind: SearchKind = "people"
  const values: SearchValues = { keywords: route.keywords ?? "", location: route.location ?? "", company: route.company ?? "", workType: route.workType ?? "", maxPages: route.maxPages ?? 1 }
  const result = searchResult(route.resultId)
  const [detail, setDetail] = useSearchSession<Row | null>(route.resultId ? `detail:${route.resultId}` : undefined, null)
  const raw = structuredSearchRows(result)[Number(route.selected)]
  const base: Row | null = raw && typeof raw === "object" ? { ...raw, search_key: route.selected } : null
  const selected = route.selected ? (detail?.search_key === route.selected ? detail : base) : null
  const selectionRef = useRef(selected)
  selectionRef.current = selected
  const setSelected = (change: SetStateAction<Row | null>) => {
    const next = typeof change === "function" ? change(selectionRef.current) : change
    setDetail(next); update({ selected: next ? String(next.search_key) : "" })
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function search() {
    setBusy(true)
    setError("")
    update({ selected: "" })
    try {
      const result = await request(`search/${kind}`, {
          keywords: values.keywords.trim(),
          location: values.location,
          company: values.company,
        })
      update({ resultId: cacheSearchResult(result), savedJobId: undefined, selected: "", selection: [], page: 0 })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { kind, values, result, selected, setSelected, busy, error, search, update, setError }
}
