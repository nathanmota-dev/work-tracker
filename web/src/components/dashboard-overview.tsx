import { Link } from "@tanstack/react-router"
import { ClipboardCheck, FileText, Gauge, GraduationCap, ListChecks, Search, Send, Sparkles, UserRound, UsersRound, type LucideIcon } from "lucide-react"
import { useApi, text, date, type Row } from "@/lib/api"
import { skills } from "@/lib/agent"
import { CardAvatar, CardBadge } from "@/components/opportunity-card"
import { humanize, relativeDay, whenLabel } from "@/components/entity-card"
import { interviewBucket, stageLabel } from "@/components/interview-card"
import {
  Stats,
  Panel,
  LoadState,
  Empty,
} from "@/components/workspace-ui"
import { DeadlinePanel } from "@/components/deadline-panel"
import { MetricChart } from "@/components/metric-chart"
import { JourneyFunnel, JourneyOverlaps } from "@/components/journey-summary"
import { Button } from "@/components/ui/button"
import { QUIET_STALE_DAYS } from "@/lib/application-board"
import {
  summaryStep,
  type ApplicationSummary,
} from "@/lib/application-journey"

function OverviewStats({ data }: { data: Row }) {
  return (
    <Stats
      items={[
        {
          label: "Saved opportunities",
          value: text(data.jobs),
          hint: `${text(data.new_jobs ?? 0)} new · ${text(data.shortlisted_jobs ?? 0)} shortlisted`,
          href: "#/jobs",
        },
        {
          label: "Submitted applications",
          value: text(journey(data)?.phases.submitted ?? 0),
          hint: `${text(journey(data)?.views.preparation ?? 0)} still in preparation`,
          href: "#/applications",
        },
        {
          label: "Recruiter connections",
          value: text(data.recruiters),
          hint: `${text(data.accepted)} accepted · ${text(data.replied)} replied`,
          href: "#/contacts",
        },
        {
          label: "Profile score",
          value: <>{text(data.score)}<span className="text-sm font-normal text-muted-foreground"> / 100</span></>,
          hint: "Your latest visibility assessment",
          href: "#/profile",
        },
      ]}
    />
  )
}

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  "job-scout": Search, "deep-scout": Search, "job-ranking": Gauge, "requirements-check": ListChecks,
  "profile-optimizer": UserRound, "recruiter-outreach": UsersRound, "outreach-tracker": Send, "recruiter-sync": UsersRound,
  "portal-filler": ClipboardCheck, "interview-prep": GraduationCap,
}
const KIND_ICONS: Record<string, LucideIcon> = { resume: FileText, application: ClipboardCheck }
const activityIcon = (row: Row) => ACTIVITY_ICONS[String(row.skill)] ?? KIND_ICONS[String(row.kind)] ?? Sparkles
/** The skill's display name, such as "Job scout" for job-scout. */
function skillName(value: unknown) {
  const id = String(value ?? "").replace(/^work-tracker-/, "")
  return skills.find(skill => skill.id === id)?.name ?? humanize(id)
}

const journey = (data: Row) => data.journey as ApplicationSummary | undefined

function ApplicationJourney({ summary, quiet }: { summary: ApplicationSummary; quiet: number }) {
  const step = summaryStep(summary)
  return (
    <Panel
      title="Application journey"
      action={
        <Button asChild size="sm" variant="outline">
          <a href={step.href}>{step.label}</a>
        </Button>
      }
    >
      <div className="space-y-3">
        <JourneyFunnel phases={summary.phases} />
        <p className="text-xs text-muted-foreground">
          {summary.views.preparation} in preparation ·{" "}
          {summary.views.tracking} on the board · {summary.views.archived}{" "}
          archived
        </p>
        <JourneyOverlaps summary={summary} />
        {quiet > 0 && (
          <p className="text-xs">
            <Link to="/applications" className="hover:underline">
              {quiet} {quiet === 1 ? "application" : "applications"} quiet for {QUIET_STALE_DAYS}+ days
            </Link>
          </p>
        )}
      </div>
    </Panel>
  )
}

function ViewAll({ to }: { to: "/interviews" | "/activity" }) {
  return (
    <Link
      to={to === "/activity" ? "/launch" : to}
      search={to === "/activity" ? { tab: "history" } : {}}
      className="text-xs text-muted-foreground hover:underline"
    >
      View all
    </Link>
  )
}

function UpcomingInterviews() {
  const interviews = useApi<Row[]>("interviews")
  const upcoming = (interviews.data ?? [])
    .filter((r) => interviewBucket(r) === "upcoming" && !Number.isNaN(new Date(String(r.scheduled_at ?? "")).getTime()))
    .slice(0, 4)
  return (
    <Panel title="Coming up" action={<ViewAll to="/interviews" />}>
      <LoadState {...interviews} retry={interviews.refresh} />
      {interviews.data &&
        (upcoming.length ? (
          <div className="divide-y">
            {upcoming.map((row) => (
              <a key={text(row.id)} href="#/interviews" className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-80">
                <CardAvatar name={text(row.company)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{text(row.company)}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{stageLabel(row.stage)} · {whenLabel(row.scheduled_at)}</p>
                </div>
                <CardBadge tone="primary">{relativeDay(row.scheduled_at)}</CardBadge>
              </a>
            ))}
          </div>
        ) : (
          <Empty
            title="A clear calendar"
            description="Upcoming interviews will appear here as they’re scheduled."
          />
        ))}
    </Panel>
  )
}

function LatestActivity() {
  const activity = useApi<Row[]>("activity")
  return (
    <Panel title="Latest activity" action={<ViewAll to="/activity" />}>
      <LoadState {...activity} retry={activity.refresh} />
      {activity.data &&
        (activity.data.length ? (
          <ul className="divide-y">
            {activity.data.slice(0, 5).map((row) => {
              const Icon = activityIcon(row)
              return (
                <li key={text(row.id)} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border text-muted-foreground"><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="line-clamp-2">{text(row.summary)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{skillName(row.skill)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeDay(row.ts) || date(row.ts)}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty
            title="A fresh start"
            description="Your searches, audits and application activity will build a timeline here."
          />
        ))}
    </Panel>
  )
}

export function DashboardOverview() {
  const overview = useApi<Row>("overview")
  const metrics = useApi<Row[]>("metrics")
  return (
    <div className="space-y-4">
      <LoadState {...overview} retry={overview.refresh} />
      {overview.data && <OverviewStats data={overview.data} />}
      {overview.data && journey(overview.data) && (
        <ApplicationJourney summary={journey(overview.data)!} quiet={Number(overview.data.quiet ?? 0)} />
      )}
      {overview.data && <DeadlinePanel items={Array.isArray(overview.data.deadlines) ? (overview.data.deadlines as Row[]) : []} />}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Profile visibility">
          <LoadState {...metrics} retry={metrics.refresh} />
          {metrics.data && <MetricChart rows={metrics.data} />}
        </Panel>
        <UpcomingInterviews />
      </div>
      <LatestActivity />
    </div>
  )
}
