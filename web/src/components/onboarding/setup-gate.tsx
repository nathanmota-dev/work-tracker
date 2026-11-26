import { useRef } from "react"
import { Navigate, type RouteComponent } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { ThemeProvider } from "@/components/theme-provider"
import { useBackend } from "@/lib/backend"
import { rememberSetup, setupRemembered, useOnboarding } from "@/lib/onboarding"

type Gate = "open" | "setup" | "waiting"
function decide({ status, loading, error }: ReturnType<typeof useOnboarding>, backend: ReturnType<typeof useBackend>): Gate {
  if (setupRemembered()) return "open"
  if (status?.setupCompletedAt) { rememberSetup(); return "open" }
  if (status) return "setup"
  if (backend && (backend.status === "failed" || backend.status === "unavailable")) return "open"
  return loading || /starting/i.test(error) ? "waiting" : "open"
}

/**
 * `setup` until the full-screen setup is finished; `waiting` while the backend
 * starts. A backend that failed opens the workspace, whose banner explains it.
 * Once open, the workspace stays mounted while the status refreshes.
 */
export function useSetupGate(): Gate {
  const onboarding = useOnboarding()
  const backend = useBackend()
  const opened = useRef(false)
  if (opened.current) return "open"
  const gate = decide(onboarding, backend)
  if (gate === "open") opened.current = true
  return gate
}

function Splash() {
  return <ThemeProvider>
    <div role="status" aria-label="Opening Work Tracker" className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">
      <Loader2 aria-hidden className="size-5 animate-spin" />
    </div>
  </ThemeProvider>
}

/** Keeps the workspace behind the setup screen until an agent is connected. */
export function withSetupGate(Layout: RouteComponent): RouteComponent {
  return function SetupGate() {
    const gate = useSetupGate()
    if (gate === "setup") return <Navigate to="/onboarding" replace />
    if (gate === "waiting") return <Splash />
    return <Layout />
  }
}
