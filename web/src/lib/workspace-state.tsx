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
  useEffect(() => { setRemembered(previous => ({ ...previous, [path]: search })) }, [path, search])
  const update = useCallback((patch: Patch) => {
    void navigate({ to: ".", search: previous => ({ ...previous, ...patch }), replace: true, resetScroll: false })
  }, [navigate])
  return <WorkspaceContext.Provider value={{ search, update, remembered }}><Outlet /></WorkspaceContext.Provider>
}

/** Isolated components can still be rendered without a router. */
export function useWorkspaceState(path: string) {
  const context = useContext(WorkspaceContext)
  const [local, setLocal] = useState(() => validateWorkspaceSearch(path || "jobs", {}))
  const enabled = ["jobs", "search", "apply", "launch"].includes(path)
  return context && enabled ? context : { search: local, update: (patch: Patch) => setLocal(previous => ({ ...previous, ...patch })) }
}

export function useWorkspaceLinks() { return useContext(WorkspaceContext)?.remembered ?? {} }
