import type { ReactNode } from "react"
import { useWorkspaceState } from "@/lib/workspace-state"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Page, PageSection } from "@/components/workspace-ui"
import { DealBreakers } from "@/components/deal-breakers"
import { AgentIndicator } from "@/components/agent-indicator"
import { ProfilePage } from "./profile"
import { ProfileOverview } from "./profile-overview"
import { AnswersPage } from "./answers"
import { RecruitersPage } from "./recruiters"
import { OutreachPage } from "./outreach"
import { SearchPage } from "./search"
import { LaunchPage } from "./launch"
import { ActivityPage } from "./activity"

/** One page whose tabs, kept in the URL, show other pages as its sections. */
function Hub({ path, title, description, tabs, aside, children }: {
  path: string
  title: string
  description?: string
  tabs: [string, string][]
  aside?: ReactNode
  children: (tab: string) => ReactNode
}) {
  const { search, update } = useWorkspaceState(path)
  const tab = search.tab ?? tabs[0][0]
  return (
    <Page title={title} description={description}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <Tabs value={tab} onValueChange={(value) => update({ tab: value })}>
          <TabsList aria-label={`${title} sections`} className="h-auto gap-6 rounded-none bg-transparent p-0">
            {tabs.map(([value, label]) => (
              <TabsTrigger key={value} value={value}
                className="-mb-px rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {aside && <div className="pb-2">{aside}</div>}
      </div>
      <PageSection>{children(tab)}</PageSection>
    </Page>
  )
}

export function ContactsHub() {
  return (
    <Hub
      path="contacts"
      title="Contacts"
      description="The people behind your next opportunity, and the follow-ups that keep each conversation going."
      tabs={[["people", "People"], ["follow-ups", "Follow-ups"]]}
    >
      {(tab) => tab === "follow-ups" ? <OutreachPage /> : <><RecruitersPage /><SearchPage /></>}
    </Hub>
  )
}

export function ProfileHub() {
  return (
    <Hub
      path="profile"
      title="Profile"
      tabs={[["profile", "Profile"], ["answers", "Questions"], ["linkedin", "LinkedIn"], ["deal-breakers", "Deal-breakers"]]}
    >
      {(tab) => tab === "answers" ? <AnswersPage />
        : tab === "linkedin" ? <ProfilePage />
        : tab === "deal-breakers" ? <DealBreakers />
        : <ProfileOverview />}
    </Hub>
  )
}

export function AgentHub() {
  return (
    <Hub
      path="launch"
      title="Agent"
      description="Run any skill with full control, and review what your agent has done."
      tabs={[["console", "Console"], ["history", "History"]]}
      aside={<AgentIndicator />}
    >
      {(tab) => tab === "history" ? <ActivityPage /> : <LaunchPage />}
    </Hub>
  )
}
