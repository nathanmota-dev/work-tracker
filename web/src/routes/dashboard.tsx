import { Sparkles } from "lucide-react"
import { DashboardOverview } from "@/components/dashboard-overview"
import { Page } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { prepareSkill } from "@/lib/agent"
export function Dashboard() {
  return (
    <Page
      title="Dashboard"
      description="A little clarity for your next career move."
      actions={
        <Button size="sm" onClick={() => prepareSkill("job-scout")}>
          <Sparkles />
          Discover opportunities
        </Button>
      }
    >
      <DashboardOverview />
    </Page>
  )
}
