import { Link } from "@tanstack/react-router"
import { useApi, text, date, type Row } from "@/lib/api"
import {
  Stats,
  Panel,
  LoadState,
  Empty,
  Status,
} from "@/components/workspace-ui"
import { DeadlinePanel } from "@/components/deadline-panel"
import { MetricChart } from "@/components/metric-chart"
import { JourneyCounts, JourneyOverlaps } from "@/components/journey-summary"
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
          value: <Link to="/jobs">{text(data.jobs)}</Link>,
          hint: `${text(data.new_jobs ?? 0)} new · ${text(data.shortlisted_jobs ?? 0)} shortlisted`,
        },
        {
          label: "Submitted applications",
          value: (
            <Link to="/applications">
              {text(journey(data)?.phases.submitted ?? 0)}
            </Link>
          ),
          hint: `${text(journey(data)?.views.preparation ?? 0)} still in preparation`,
        },
        {
          label: "Recruiter connections",
          value: (
            <Link to="/recruiters">{text(data.recruiters)}</Link>
          ),
          hint: `${text(data.accepted)} accepted · ${text(data.replied)} replied`,
        },
        {
          label: "Profile score",
          value: (
            <Link to="/profile">
              {text(data.score)}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / 100
              </span>
            </Link>
          ),
          hint: "Your latest visibility assessment",
        },
      ]}
    />
  )
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
        <JourneyCounts phases={summary.phases} href="#/applications" />
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
    .filter(
      (r) =>
        r.status !== "closed" &&
        r.scheduled_at &&
        new Date(String(r.scheduled_at)).getTime() >= Date.now(),
    )
    .slice(0, 4)
  return (
    <Panel title="Coming up" action={<ViewAll to="/interviews" />}>
      <LoadState {...interviews} retry={interviews.refresh} />
      {interviews.data &&
        (upcoming.length ? (
          <div className="divide-y">
            {upcoming.map((row) => (
              <div
                key={text(row.id)}
                className="flex items-center gap-3 py-4"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/30 text-xs font-medium">
                  {text(row.company).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{text(row.company)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {date(row.scheduled_at)}
                  </p>
                </div>
                <Status value={row.stage} />
              </div>
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
          activity.data.slice(0, 5).map((row) => (
            <div
              key={text(row.id)}
              className="flex gap-4 border-b py-3 last:border-0"
            >
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-chart-2" />
              <div className="flex-1 text-sm">
                {text(row.summary)}
                <p className="mt-1 text-xs text-muted-foreground">
                  {text(row.skill)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {date(row.ts)}
              </span>
            </div>
          ))
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
