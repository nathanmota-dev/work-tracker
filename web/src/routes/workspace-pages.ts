import {
  Activity,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Rocket,
  Search,
  Send,
  UserRound,
  UsersRound,
} from "lucide-react"
import { ApplyPage } from "@/routes/apply"
import { ActivityPage } from "@/routes/activity"
import { AnswersPage } from "@/routes/answers"
import { ApplicationsPage } from "@/routes/applications"
import { InterviewsPage } from "@/routes/interviews"
import { JobsPage } from "@/routes/jobs"
import { LaunchPage } from "@/routes/launch"
import { OutreachPage } from "@/routes/outreach"
import { ProfilePage } from "@/routes/profile"
import { RecruitersPage } from "@/routes/recruiters"
import { SearchPage } from "@/routes/search"

export const workspacePages = [
  { path: "profile", title: "Profile", icon: UserRound, component: ProfilePage },
  { path: "search", title: "Search", icon: Search, component: SearchPage },
  { path: "launch", title: "Agent", icon: Rocket, component: LaunchPage },
  { path: "recruiters", title: "Recruiters", icon: UsersRound, component: RecruitersPage },
  { path: "outreach", title: "Outreach", icon: Send, component: OutreachPage },
  // Application detail, opened from Jobs and Applications; not a sidebar entry.
  { path: "apply", title: "Application", icon: FileText, component: ApplyPage },
  { path: "jobs", title: "Jobs", icon: BriefcaseBusiness, component: JobsPage },
  { path: "applications", title: "Applications", icon: ClipboardCheck, component: ApplicationsPage },
  { path: "answers", title: "Answers", icon: ClipboardList, component: AnswersPage },
  { path: "interviews", title: "Interviews", icon: CalendarClock, component: InterviewsPage },
  { path: "activity", title: "Activity", icon: Activity, component: ActivityPage },
] as const
