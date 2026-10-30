import { Sparkles } from "lucide-react"
import { DashboardOverview } from "@/components/dashboard-overview"
import { Page } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { Link } from "@tanstack/react-router"
export function Dashboard() {
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
      <DashboardOverview />
    </Page>
  )
}
