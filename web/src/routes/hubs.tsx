import { useWorkspaceState } from "@/lib/workspace-state"
import { Button } from "@/components/ui/button"
import { ResumeSources } from "@/components/resume-sources"
import { prepareSkill } from "@/lib/agent"
import { ProfilePage } from "./profile"
import { AnswersPage } from "./answers"
import { RecruitersPage } from "./recruiters"
import { OutreachPage } from "./outreach"
import { SearchPage } from "./search"
import { LaunchPage } from "./launch"
import { ActivityPage } from "./activity"

function HubTabs({ path, tabs }: { path: string; tabs: [string, string][] }) {
  const { search, update } = useWorkspaceState(path)
  return <div role="tablist" className="flex gap-2 p-4">{tabs.map(([value, label]) => <Button key={value} role="tab" aria-selected={(search.tab ?? tabs[0][0]) === value} variant={(search.tab ?? tabs[0][0]) === value ? "default" : "outline"} onClick={() => update({ tab: value })}>{label}</Button>)}</div>
}
export function ContactsHub() {
  const { search } = useWorkspaceState("contacts")
  return <><h1 className="px-4 text-2xl font-semibold">Contacts</h1><HubTabs path="contacts" tabs={[["people", "People"], ["follow-ups", "Follow-ups"]]} />{search.tab === "follow-ups" ? <OutreachPage /> : <><RecruitersPage /><SearchPage /></>}</>
}
export function ProfileHub() {
  const { search } = useWorkspaceState("profile")
  return <>{(search.tab ?? "linkedin") !== "linkedin" && <h1 className="px-4 text-2xl font-semibold">Profile</h1>}<HubTabs path="profile" tabs={[["linkedin", "LinkedIn"], ["resume", "Base resume"], ["answers", "Answers"], ["experiences", "Experiences"]]} />{search.tab === "resume" ? <ResumeSources /> : search.tab === "answers" ? <AnswersPage /> : search.tab === "experiences" ? <Button onClick={() => prepareSkill("experience-bank")}>Update experiences</Button> : <ProfilePage />}</>
}
export function AgentHub() {
  const { search } = useWorkspaceState("launch")
  return <><HubTabs path="launch" tabs={[["console", "Console"], ["history", "History"]]} />{search.tab === "history" ? <ActivityPage /> : <LaunchPage />}</>
}
