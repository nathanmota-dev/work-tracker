import { Link } from "@tanstack/react-router"
import { useApi, text, date, type Row } from "@/lib/api"
import {
  Stats,
  Panel,
  LoadState,
  Empty,
  Status,
} from "@/components/workspace-ui"
import { MetricChart } from "@/components/metric-chart"
export function DashboardOverview() {
  const overview = useApi<Row>("overview")
  const metrics = useApi<Row[]>("metrics")
  const interviews = useApi<Row[]>("interviews")
  const activity = useApi<Row[]>("activity")
  const upcoming = (interviews.data ?? [])
    .filter(
      (r) =>
        r.status !== "closed" &&
        r.scheduled_at &&
        new Date(String(r.scheduled_at)).getTime() >= Date.now(),
    )
    .slice(0, 4)
  return (
    <div className="space-y-4">
      <LoadState {...overview} retry={overview.refresh} />
      {overview.data && (
        <Stats
          items={[
            {
              label: "Saved opportunities",
              value: <Link to="/jobs">{text(overview.data.jobs)}</Link>,
              hint: "Your next chapter starts here",
            },
            {
              label: "Applications",
              value: (
                <Link to="/applications">
                  {text(overview.data.applications)}
                </Link>
              ),
              hint: "Roles you’re moving forward with",
            },
            {
              label: "Recruiter connections",
              value: (
                <Link to="/recruiters">{text(overview.data.recruiters)}</Link>
              ),
              hint: `${text(overview.data.accepted)} accepted · ${text(overview.data.replied)} replied`,
            },
            {
              label: "Profile score",
              value: (
                <Link to="/profile">
                  {text(overview.data.score)}
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
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Profile visibility">
          <LoadState {...metrics} retry={metrics.refresh} />
          {metrics.data && <MetricChart rows={metrics.data} />}
        </Panel>
        <Panel
          title="Coming up"
          action={
            <Link
              to="/interviews"
              className="text-xs text-muted-foreground hover:underline"
            >
              View all
            </Link>
          }
        >
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
      </div>
      <Panel
        title="Latest activity"
        action={
          <Link
            to="/activity"
            className="text-xs text-muted-foreground hover:underline"
          >
            View all
          </Link>
        }
      >
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
    </div>
  )
}
