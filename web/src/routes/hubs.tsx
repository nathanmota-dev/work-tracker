import type { ReactNode } from "react"
import { useWorkspaceState } from "@/lib/workspace-state"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Empty, Page, PageSection, Panel } from "@/components/workspace-ui"
import { ResumeSources } from "@/components/resume-sources"
import { ProfileSources } from "@/components/profile-sources"
import { DealBreakers } from "@/components/deal-breakers"
import { prepareSkill } from "@/lib/agent"
import { ProfilePage } from "./profile"
import { AnswersPage } from "./answers"
import { RecruitersPage } from "./recruiters"
import { OutreachPage } from "./outreach"
import { SearchPage } from "./search"
import { LaunchPage } from "./launch"
import { ActivityPage } from "./activity"

/** One page whose tabs, kept in the URL, show other pages as its sections. */
function Hub({ path, title, description, tabs, children }: {
  path: string
  title: string
  description: string
  tabs: [string, string][]
  children: (tab: string) => ReactNode
}) {
  const { search, update } = useWorkspaceState(path)
  const tab = search.tab ?? tabs[0][0]
  return (
    <Page title={title} description={description}>
      <Tabs value={tab} onValueChange={(value) => update({ tab: value })}>
        <TabsList aria-label={`${title} sections`}>
          {tabs.map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
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

function BaseResume() {
  return (
    <Page title="Base resume" description="The LaTeX project every tailored resume starts from, and the profile evidence it is tailored with.">
      <ResumeSources />
      <ProfileSources />
    </Page>
  )
}

function Experiences() {
  return (
    <Page
      title="Experiences"
      description="Achievements and projects that do not fit on your base resume."
      actions={<Button size="sm" onClick={() => prepareSkill("experience-bank")}>Update experiences</Button>}
    >
      <Panel title="Experience bank">
        <Empty
          title="Capture what your resume leaves out"
          description="The agent interviews you about recent work and saves it to your experience bank. Tailored resumes use it when a role asks for experience your base resume does not show."
        />
      </Panel>
    </Page>
  )
}

export function ProfileHub() {
  return (
    <Hub
      path="profile"
      title="Profile"
      description="Everything your applications and your agent know about you."
      tabs={[["linkedin", "LinkedIn"], ["resume", "Base resume"], ["answers", "Answers"], ["experiences", "Experiences"], ["deal-breakers", "Deal-breakers"]]}
    >
      {(tab) => tab === "resume" ? <BaseResume />
        : tab === "answers" ? <AnswersPage />
        : tab === "experiences" ? <Experiences />
        : tab === "deal-breakers" ? <DealBreakers />
        : <ProfilePage />}
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
    >
      {(tab) => tab === "history" ? <ActivityPage /> : <LaunchPage />}
    </Hub>
  )
}
