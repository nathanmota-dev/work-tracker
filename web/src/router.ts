import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  stripSearchParams,
  type RouteComponent,
} from "@tanstack/react-router"
import { WorkspaceRoute } from "@/lib/workspace-state"
import { validateWorkspaceSearch } from "@/lib/workspace-search"
import { Dashboard } from "@/routes/dashboard"
import { SettingsPage } from "@/routes/settings"
import { workspacePages } from "@/routes/workspace-pages"

export function createAppRouter(sidebarLayout: RouteComponent) {
  const rootRoute = createRootRoute({ component: WorkspaceRoute })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/dashboard", replace: true })
    },
  })

  const sidebarRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "sidebar",
    component: sidebarLayout,
    staticData: { title: "Workspace" },
  })

  const dashboardRoute = createRoute({
    getParentRoute: () => sidebarRoute,
    path: "dashboard",
    component: Outlet,
    staticData: { title: "Dashboard" },
  })

  const dashboardIndexRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "/",
    component: Dashboard,
  })

  const settingsRoute = createRoute({
    getParentRoute: () => sidebarRoute,
    path: "settings",
    component: SettingsPage,
    validateSearch: (search: Record<string, unknown>): { section?: string; target?: string } => ({ section: typeof search.section === "string" ? search.section : undefined, target: typeof search.target === "string" ? search.target : undefined }),
    staticData: { title: "Settings" },
  })

  const routeTree = rootRoute.addChildren([
    indexRoute,
    sidebarRoute.addChildren([
      dashboardRoute.addChildren([dashboardIndexRoute]),
      settingsRoute,
      ...workspacePages.map((page) =>
        createRoute({
          getParentRoute: () => sidebarRoute,
          path: page.path,
          component: page.component,
          beforeLoad: ({ search }) => {
            if (page.path === "search" && search.kind === "jobs")
              throw redirect({ to: "/jobs", search: validateWorkspaceSearch("jobs", search), replace: true })
          },
          validateSearch: (search: Record<string, unknown>) => validateWorkspaceSearch(page.path, search),
          search: { middlewares: [stripSearchParams(validateWorkspaceSearch(page.path, {}))] },
          staticData: { title: page.title },
        }),
      ),
    ]),
  ])

  return createRouter({
    routeTree,
    history: createHashHistory(),
  })
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    title?: string
  }

  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
