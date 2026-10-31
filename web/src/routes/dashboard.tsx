import { Sparkles } from "lucide-react"
import { DashboardOverview } from "@/components/dashboard-overview"
import { GetStarted } from "@/components/get-started"
import { Page } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Link } from "@tanstack/react-router"
import { useWorkspaceState } from "@/lib/workspace-state"
export function Dashboard() {
  const { search } = useWorkspaceState("dashboard")
  return (
    <Page
      title="Dashboard"
      description="A little clarity for your next career move."
      actions={
        <Button size="sm" asChild><Link to="/jobs" search={{ focus: true }}>
          <Sparkles />
          Discover opportunities
        </Link></Button>
      }
    >
      <GetStarted focus={search.step} />
      <DashboardOverview />
    </Page>
  )
}
