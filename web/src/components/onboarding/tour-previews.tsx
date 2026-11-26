import type { ReactNode } from "react"
import { Briefcase, CalendarClock, Check, FileText, KanbanSquare, MessagesSquare, Search, Send, Sparkles, Users } from "lucide-react"
import { cn } from "@/lib/utils"

/*
 * Illustrations of the main screens, drawn with theme tokens so they follow
 * light and dark mode. They show the idea of each screen, not live data.
 */

/** A miniature app window with tabs; the bottom fades out like a cropped screenshot. */
function Frame({ tabs, active, children, caption }: { tabs: string[]; active: string; children: ReactNode; caption: ReactNode }) {
  return <figure aria-hidden className="flex flex-col gap-4">
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
      <div className="flex gap-1 border-b bg-muted/50 p-1.5">
        {tabs.map(tab => <span key={tab} className={cn("flex-1 rounded-md py-1 text-center text-[10px] font-medium", tab === active ? "bg-background shadow-xs" : "text-muted-foreground")}>{tab}</span>)}
      </div>
      <div className="space-y-3 p-4 pb-8">{children}</div>
    </div>
    <figcaption className="text-center text-sm text-muted-foreground">{caption}</figcaption>
  </figure>
}

const Bar = ({ className }: { className?: string }) => <span className={cn("block h-1.5 rounded-full bg-muted-foreground/20", className)} />
function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "accent" }) {
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-medium", tone === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : tone === "accent" ? "bg-chart-1/15 text-chart-1" : "bg-muted text-muted-foreground")}>{children}</span>
}

const highlights = [
  { icon: Search, title: "Discover roles", text: "Search LinkedIn or let your agent find and rank jobs." },
  { icon: FileText, title: "Apply faster", text: "Tailored resumes and portals filled for your review." },
  { icon: KanbanSquare, title: "Track progress", text: "Applications, interviews and deadlines on one board." },
  { icon: Users, title: "Follow up", text: "Recruiters and follow-ups so no conversation goes cold." },
]
/** First screen: what the app does, in four cards. */
export function WelcomePreview() {
  return <ul aria-label="What Work Tracker does" className="grid gap-3 sm:grid-cols-2">
    {highlights.map(({ icon: Icon, title, text }) => <li key={title} className="rounded-xl border bg-background p-4">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Icon aria-hidden className="size-4" /></span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </li>)}
  </ul>
}

const jobs = [
  { company: "Northwind", title: "Senior React Engineer", fit: "Strong fit", tone: "good" as const, shortlisted: true },
  { company: "Globex", title: "Frontend Platform Engineer", fit: "Good fit", tone: "accent" as const, shortlisted: true },
  { company: "Initech", title: "Full-stack Developer", fit: "Stretch", tone: "muted" as const, shortlisted: false },
]
export function DiscoverPreview() {
  return <Frame tabs={["New", "Shortlist", "Archived"]} active="New" caption={<><b className="font-semibold text-foreground">Jobs</b> keeps every role you find, ready to triage.</>}>
    <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
      <Search className="size-3 text-muted-foreground" /><span className="text-[11px]">React · Remote · Last week</span>
      <span className="ml-auto flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"><Sparkles className="size-2.5" /> Find with agent</span>
    </div>
    {jobs.map(job => <div key={job.title} className="flex items-center gap-3 rounded-lg border p-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold">{job.company[0]}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{job.title}</span><span className="block text-[10px] text-muted-foreground">{job.company} · Remote</span></span>
      <Chip tone={job.tone}>{job.fit}</Chip>
      <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px]", job.shortlisted && "border-foreground/30 font-medium")}>{job.shortlisted ? "Shortlist ✓" : "Shortlist"}</span>
    </div>)}
  </Frame>
}

const fill = ["Name and contact", "Resume uploaded", "Work authorization", "Why this company?"]
export function ApplyPreview() {
  return <Frame tabs={["Tailor", "Review", "Fill"]} active="Review" caption={<><b className="font-semibold text-foreground">Apply</b> never submits for you: you review and send.</>}>
    <div className="grid gap-3 sm:grid-cols-[3fr_2fr]">
      <div className="space-y-2 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium"><FileText className="size-3" /> resume-northwind.pdf</p>
        <Bar className="w-2/3" /><Bar />
        <span className="block rounded bg-emerald-500/10 px-1 py-0.5"><Bar className="w-5/6 bg-emerald-500/40" /></span>
        <Bar className="w-4/5" />
        <span className="block rounded bg-emerald-500/10 px-1 py-0.5"><Bar className="w-3/4 bg-emerald-500/40" /></span>
        <Bar className="w-1/2" />
        <div className="flex gap-1.5 pt-1"><Chip tone="good">ATS 86%</Chip><Chip>Approved</Chip></div>
      </div>
      <div className="space-y-1.5 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium"><Send className="size-3" /> Portal fill</p>
        {fill.map((item, index) => <p key={item} className="flex items-center gap-1.5 text-[10px]">
          <span className={cn("flex size-3 items-center justify-center rounded-sm border", index < 3 && "border-transparent bg-emerald-500 text-white")}>{index < 3 && <Check className="size-2" />}</span>
          <span className={index < 3 ? "text-muted-foreground" : ""}>{item}</span>
        </p>)}
      </div>
    </div>
  </Frame>
}

const columns = [
  { title: "Applied", cards: ["Northwind", "Umbrella"] },
  { title: "Interview", cards: ["Globex"] },
  { title: "Offer", cards: [] as string[] },
]
export function TrackPreview() {
  return <Frame tabs={["Board", "List", "Archive"]} active="Board" caption={<><b className="font-semibold text-foreground">Applications</b>, <b className="font-semibold text-foreground">Interviews</b> and <b className="font-semibold text-foreground">Contacts</b> pick up from there.</>}>
    <div className="grid grid-cols-3 gap-2">
      {columns.map(column => <div key={column.title} className="space-y-1.5 rounded-lg bg-muted/50 p-2">
        <p className="text-[10px] font-medium text-muted-foreground">{column.title} · {column.cards.length}</p>
        {column.cards.map(card => <div key={card} className="space-y-1 rounded-md border bg-background p-2"><p className="text-[10px] font-medium">{card}</p><Bar className="w-3/4" /></div>)}
        {!column.cards.length && <div className="h-10 rounded-md border border-dashed" />}
      </div>)}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center gap-2 rounded-lg border p-2"><CalendarClock className="size-3.5 text-chart-1" /><span className="text-[10px]">Technical interview · Thu 10:00</span></div>
      <div className="flex items-center gap-2 rounded-lg border p-2"><MessagesSquare className="size-3.5 text-chart-2" /><span className="text-[10px]">Follow up with Alex · due today</span></div>
    </div>
  </Frame>
}

const tiles = [
  { icon: Briefcase, label: "Saved jobs", value: "24" },
  { icon: Send, label: "Applications", value: "8" },
  { icon: CalendarClock, label: "Interviews", value: "2" },
]
export function DashboardPreview() {
  return <Frame tabs={["Dashboard", "Jobs", "Applications"]} active="Dashboard" caption={<>Hit <b className="font-semibold text-foreground">Go to Dashboard</b> on the left to start exploring.</>}>
    <div className="grid grid-cols-3 gap-2">
      {tiles.map(({ icon: Icon, label, value }) => <div key={label} className="rounded-lg border p-2.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <p className="mt-2 text-base font-semibold">{value}</p><p className="text-[10px] text-muted-foreground">{label}</p>
      </div>)}
    </div>
    <div className="rounded-lg border p-3">
      <p className="text-[11px] font-medium">Applications this month</p>
      <svg viewBox="0 0 200 60" className="mt-2 h-20 w-full text-chart-1" preserveAspectRatio="none">
        <defs><linearGradient id="onboarding-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.35" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 50 L30 44 L60 46 L90 30 L120 32 L150 20 L180 22 L200 8 L200 60 L0 60 Z" fill="url(#onboarding-area)" />
        <path d="M0 50 L30 44 L60 46 L90 30 L120 32 L150 20 L180 22 L200 8" fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  </Frame>
}
