import { candidateFromAnswers, candidateName } from "@/lib/candidate-profile"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Page,
  Panel,
  Stats,
  LoadState,
  Empty,
  ExternalLink,
} from "@/components/workspace-ui"
import { MetricChart } from "@/components/metric-chart"
import { useApi, text, date, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
function ProfileIdentity({ identity, email }: { identity: Row; email: string }) {
  return (
    <Panel title="Your professional profile">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback>
            {text(identity.name)
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h2 className="font-medium">{text(identity.name)}</h2>
          <p className="mt-1 text-sm">{text(identity.headline)}</p>
          {email && (
            <p className="mt-1 text-sm text-muted-foreground">
              {email}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {text(identity.location)} · {text(identity.current_company)}
          </p>
        </div>
        <ExternalLink
          value={
            identity.username
              ? `https://www.linkedin.com/in/${encodeURIComponent(String(identity.username))}/`
              : null
          }
          label="LinkedIn profile"
        />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {identity.last_synced_at
          ? `Last synced ${date(identity.last_synced_at)}`
          : "Run a profile audit to add your LinkedIn insights."}
      </p>
    </Panel>
  )
}

function SnapshotStats({ data }: { data: Row }) {
  return (
    <Stats
      items={[
        {
          label: "Profile score",
          value: `${text(data.score)} / 100`,
        },
        {
          label: "Search appearances",
          value: text(data.searchAppearances),
        },
        { label: "Profile views", value: text(data.profileViews) },
        {
          label: "Connections",
          value: text(data.connections),
          hint: `${text(data.postImpressions)} post impressions`,
        },
      ]}
    />
  )
}

function ProfileAssessment({ breakdown }: { breakdown: unknown }) {
  return (
    <Panel title="Profile assessment">
      {Array.isArray(breakdown) && breakdown.length ? (
        <dl className="divide-y">
          {(
            breakdown as { label: string; value: string }[]
          ).map((item, i) => (
            <div
              key={i}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="text-right">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Empty
          title="No assessment yet"
          description="Your next audit will highlight what’s working and what to improve."
        />
      )}
    </Panel>
  )
}

export function ProfilePage() {
  const profile = useApi<Row | null>("profile")
  const personal = useApi<Row[]>("answers")
  const candidate = candidateFromAnswers(personal.data ?? [])
  const identity: Row | null =
    profile.data ||
    candidateName(candidate) ||
    candidate.linkedinUsername ||
    candidate.email
      ? {
          ...profile.data,
          name: candidateName(candidate) || profile.data?.name,
          username: candidate.linkedinUsername || profile.data?.username,
        }
      : null
  const snapshot = useApi<Row>("profile-snapshot")
  const metrics = useApi<Row[]>("metrics")
  return (
    <Page
      title="Profile"
      description="Understand how you show up, and where to grow."
      actions={
        <Button size="sm" onClick={() => prepareSkill("profile-optimizer")}>
          Audit profile
        </Button>
      }
    >
      <LoadState {...profile} retry={profile.refresh} />
      {identity ? (
        <ProfileIdentity identity={identity} email={candidate.email} />
      ) : (
        !profile.loading &&
        !profile.error && (
          <Panel title="Your profile">
            <Empty
              title="Let’s get to know you"
              description="Run a profile audit to bring your LinkedIn profile into your workspace."
            />
          </Panel>
        )
      )}
      <LoadState {...snapshot} retry={snapshot.refresh} />
      {snapshot.data?.hasScan === true && (
        <SnapshotStats data={snapshot.data} />
      )}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Visibility over time">
          <LoadState {...metrics} retry={metrics.refresh} />
          {metrics.data && <MetricChart rows={metrics.data} />}
        </Panel>
        <ProfileAssessment breakdown={snapshot.data?.breakdown} />
      </div>
    </Page>
  )
}
