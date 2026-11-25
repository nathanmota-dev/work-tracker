import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import { validateWorkspaceSearch, type WorkspaceSearch } from "./workspace-search"
import { useNavigationScroll } from "./workspace-scroll"

type Patch = Partial<WorkspaceSearch>
const WorkspaceContext = createContext<{ search: WorkspaceSearch; update: (patch: Patch) => void; remembered: Record<string, WorkspaceSearch> } | null>(null)

export function WorkspaceRoute() {
  const search = useSearch({ strict: false }) as WorkspaceSearch
  const navigate = useNavigate()
  const path = useRouterState({ select: state => state.location.pathname })
  useNavigationScroll(path)
  const [remembered, setRemembered] = useState<Record<string, WorkspaceSearch>>({})
  useEffect(() => {
    // Discover opportunities is a transient view of Jobs: the sidebar link always returns to the cards.
    const { discover: _discover, focus: _focus, ...kept } = search
    setRemembered(previous => ({ ...previous, [path]: kept }))
  }, [path, search])
  const update = useCallback((patch: Patch) => {
    void navigate({ to: ".", search: previous => ({ ...previous, ...patch }), replace: true, resetScroll: false })
  }, [navigate])
  return <WorkspaceContext.Provider value={{ search, update, remembered }}><Outlet /></WorkspaceContext.Provider>
}

/** Isolated components can still be rendered without a router. */
export function useWorkspaceState(path: string) {
  const context = useContext(WorkspaceContext)
  const [local, setLocal] = useState(() => validateWorkspaceSearch(path || "jobs", {}))
  const enabled = ["dashboard", "contacts", "profile", "jobs", "applications", "search", "apply", "launch", "answers", "interview-prep"].includes(path)
  return context && enabled ? context : { search: local, update: (patch: Patch) => setLocal(previous => ({ ...previous, ...patch })) }
}

export function useWorkspaceLinks() { return useContext(WorkspaceContext)?.remembered ?? {} }
