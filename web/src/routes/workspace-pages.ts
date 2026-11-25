import { ContactsHub, ProfileHub, AgentHub } from "./hubs"
import {
  Activity,
  BriefcaseBusiness,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Files,
  GraduationCap,
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
import { InterviewPrepPage } from "@/routes/interview-prep"
import { JobsPage } from "@/routes/jobs"
import { OutreachPage } from "@/routes/outreach"
import { RecruitersPage } from "@/routes/recruiters"
import { SearchPage } from "@/routes/search"
import { ResumesPage } from "@/routes/resumes"
import { ResumeDetailPage } from "@/routes/resume-detail"

export const workspacePages = [
  { path: "contacts", title: "Contacts", icon: UsersRound, component: ContactsHub },
  { path: "profile", title: "Profile", icon: UserRound, component: ProfileHub },
  { path: "resumes", title: "Resumes", icon: Files, component: ResumesPage },
  // Saved resume detail, opened from Resumes; not a sidebar entry.
  { path: "resume", title: "Resume", icon: FileText, component: ResumeDetailPage },
  { path: "search", title: "Search", icon: Search, component: SearchPage },
  { path: "launch", title: "Agent", icon: Rocket, component: AgentHub },
  { path: "recruiters", title: "Recruiters", icon: UsersRound, component: RecruitersPage },
  { path: "outreach", title: "Outreach", icon: Send, component: OutreachPage },
  // Application detail, opened from Jobs and Applications; not a sidebar entry.
  { path: "apply", title: "Application", icon: FileText, component: ApplyPage },
  { path: "jobs", title: "Jobs", icon: BriefcaseBusiness, component: JobsPage },
  { path: "applications", title: "Applications", icon: ClipboardCheck, component: ApplicationsPage },
  { path: "answers", title: "Answers", icon: ClipboardList, component: AnswersPage },
  { path: "interviews", title: "Interviews", icon: CalendarClock, component: InterviewsPage },
  { path: "interview-prep", title: "Interview prep", icon: GraduationCap, component: InterviewPrepPage },
  { path: "activity", title: "Activity", icon: Activity, component: ActivityPage },
] as const
