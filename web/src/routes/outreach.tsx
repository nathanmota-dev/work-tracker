import { ChevronDown, MessageSquareReply } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Page, Stats, LoadState, Empty, Field, controlClass } from "@/components/workspace-ui"
import { CardBadge, CardLinkButton } from "@/components/opportunity-card"
import { CountLine, EntityCard, humanize } from "@/components/entity-card"
import { linkedinUrl } from "@/components/recruiter-cards"
import { useApi, useConnection, openExternal, text, type Row } from "@/lib/api"
import { runAgent, useAgent } from "@/lib/agent"
import { Textarea } from "@/components/ui/textarea"
import { AgentExecution } from "@/components/agent-panel"
import { AgentRunNote, DiscoverLayout } from "@/components/discover-layout"
import { useDefaultAgent } from "@/lib/default-agent"
import { useSkillInputs } from "@/lib/skill-inputs"

type Outreach = {
  funnel: Record<string, number>
  due: Row[]
  blocked: Row[]
  budget: Row
}

const ACTIONS: Record<string, string> = { withdraw: "Withdraw invite", followup: "Send a follow-up", close: "Close conversation" }

/** "invite unaccepted for 30d (≥ 7d)" as "Invite not accepted after 30 days". */
export function reasonText(value: unknown) {
  const reason = String(value ?? "").replace(/\s*\(≥[^)]*\)/g, "").replace(/(\d+)d\b/g, (_, n) => `${n} ${n === "1" ? "day" : "days"}`)
    .replace(/^invite unaccepted for/, "invite not accepted after")
  return reason ? reason[0].toUpperCase() + reason.slice(1) : ""
}


function ActionCard({ row, onReview }: { row: Row; onReview?: () => void }) {
  const name = text(row.person_name ?? row.person_username)
  const profile = linkedinUrl({ username: row.person_username })
  return (
    <EntityCard
      name={name}
      eyebrow={text(row.company_name ?? row.company_urn)}
      title={name}
      badges={<><CardBadge tone="warn">{ACTIONS[String(row.actionKind)] ?? humanize(row.actionKind)}</CardBadge><CardBadge>{humanize(row.state)}</CardBadge></>}
      menu={profile && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void openExternal(profile).catch(() => {})}>LinkedIn</Button>}
      action={onReview && <CardLinkButton label="Review" onClick={onReview} />}
    >
      <p className="text-sm text-muted-foreground">{reasonText(row.actionReason)}</p>
    </EntityCard>
  )
}

function Lifecycle({ funnel }: { funnel: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(funnel))
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
      {Object.entries(funnel).map(([key, count]) => (
        <div key={key}>
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-muted-foreground">{humanize(key)}</span>
            <span className="tabular-nums">{count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Lifecycle, InMail budget and cooldowns: context, folded below the actions. */
function OutreachHealth({ data }: { data: Outreach }) {
  const { budget } = data
  const summary = `${data.funnel.engaged ?? 0} active · ${data.funnel.invited ?? 0} invited · ${text(budget.credits_remaining)} InMail credits · ${data.blocked.length} in cooldown`
  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Outreach health</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary}</p>
        </div>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-6 border-t p-5">
        <Stats items={[
          { label: "Active conversations", value: data.funnel.engaged ?? 0 },
          { label: "InMail credits", value: text(budget.credits_remaining), hint: `${text(budget.credits_used_this_cycle)} used this cycle` },
          { label: "Credit reserve", value: text(budget.reserve_floor), hint: `${text(budget.plan)} plan · ${text(budget.inmail_monthly_allotment)} monthly · ${text(budget.inmail_rollover_cap)} rollover cap` },
        ]} className="xl:grid-cols-3" />
        <section className="space-y-3">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Connection lifecycle</h4>
          <Lifecycle funnel={data.funnel} />
        </section>
        <section className="space-y-3">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Companies in cooldown</h4>
          {data.blocked.length ? (
            <ul className="flex flex-wrap gap-2">
              {data.blocked.map(row => (
                <li key={text(row.company_urn)} className="rounded-full border px-3 py-1 text-xs">
                  {text(row.company_name ?? row.company_urn)} <span className="text-muted-foreground">· {text(row.count)} blocked</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No company is in cooldown.</p>}
        </section>
      </div>
    </details>
  )
}

/** Starts the follow-up review in place, with the user's saved context, on the default agent. */
function useFollowupReview() {
  const agent = useAgent()
  const live = useConnection()
  const defaults = useDefaultAgent()
  const { inputs, setInputs } = useSkillInputs("outreach-tracker")
  const canRun = !!defaults.selectedProvider && live && !agent.running
  const run = () => {
    if (canRun && defaults.selectedProvider)
      void runAgent(defaults.selectedProvider.id, "outreach-tracker", inputs.extra?.trim() ? { extra: inputs.extra } : {}, defaults.effectiveModel || undefined, defaults.effectiveEffort || undefined)
  }
  return { agent, live, defaults, inputs, setInputs, canRun, run }
}

/** Due follow-ups and the agent's review: the actions and the review form on the left, the agent's work on the right. */
export function OutreachPage() {
  const api = useApi<Outreach>("outreach")
  const review = useFollowupReview()
  return (
    <Page title="Follow-ups" fill>
      <DiscoverLayout title="Review follow-ups with your agent" output={<AgentExecution fill skills={["outreach-tracker"]} />}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); review.run() }}>
          <p className="text-sm text-muted-foreground">Your agent checks what is due today, drafts each message and detects replies. It never sends anything without your approval.</p>
          <Field label="Additional context">
            <Textarea className={`${controlClass} h-28 resize-y py-2`} placeholder="Tone, people to skip, what to mention…" disabled={review.agent.running}
              value={review.inputs.extra ?? ""} onChange={event => review.setInputs({ extra: event.target.value })} />
          </Field>
          <Button className="w-full" disabled={!review.canRun}><MessageSquareReply /> {review.agent.running ? "Agent is running…" : "Review follow-ups"}</Button>
          <AgentRunNote agent={review.defaults} live={review.live} />
        </form>
        <div className="mt-6 space-y-4 border-t pt-4">
          <LoadState {...api} loading={api.loading && !api.data} retry={api.refresh} />
          {api.data && (
            <>
              <CountLine label="Next actions" shown={api.data.due.length} total={api.data.due.length} />
              {api.data.due.length ? (
                <div className="space-y-3">{api.data.due.map(row => <ActionCard key={text(row.id)} row={row} onReview={review.canRun ? review.run : undefined} />)}</div>
              ) : (
                <Empty title="Nothing due today" description="Nudges, invitation withdrawals and close-outs appear here when they are due." />
              )}
              <OutreachHealth data={api.data} />
            </>
          )}
        </div>
      </DiscoverLayout>
    </Page>
  )
}
