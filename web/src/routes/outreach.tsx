import { Button } from "@/components/ui/button"
import {
  Page,
  Panel,
  Stats,
  LoadState,
  Status,
} from "@/components/workspace-ui"
import { Records } from "@/components/records"
import { useApi, text, type Row } from "@/lib/api"
import { prepareSkill } from "@/lib/agent"
type Outreach = {
  funnel: Record<string, number>
  due: Row[]
  blocked: Row[]
  budget: Row
}
export function OutreachPage() {
  const api = useApi<Outreach>("outreach")
  const total = Object.values(api.data?.funnel ?? {}).reduce((a, b) => a + b, 0)
  return (
    <Page
      title="Outreach"
      description="Thoughtful follow-ups. Stronger connections."
      actions={
        <Button size="sm" onClick={() => prepareSkill("outreach-tracker")}>
          Review follow-ups
        </Button>
      }
    >
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <>
          <Stats
            items={[
              { label: "Active conversations", value: api.data.funnel.engaged },
              { label: "Actions due", value: api.data.due.length },
              {
                label: "InMail credits",
                value: text(api.data.budget.credits_remaining),
                hint: `${text(api.data.budget.credits_used_this_cycle)} used this cycle`,
              },
              {
                label: "Credit reserve",
                value: text(api.data.budget.reserve_floor),
                hint: `${text(api.data.budget.plan)} plan · ${text(api.data.budget.inmail_monthly_allotment)} monthly · ${text(api.data.budget.inmail_rollover_cap)} rollover cap`,
              },
            ]}
          />
          <Panel title="Connection lifecycle">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(api.data.funnel).map(([key, count]) => (
                <div key={key}>
                  <div className="mb-2 flex justify-between text-xs">
                    <span className="capitalize text-muted-foreground">
                      {key.replaceAll("_", " ")}
                    </span>
                    <span>{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-1"
                      style={{ width: `${total ? (count / total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Records
            rows={api.data.due}
            noun="Next actions"
            columns={[
              {
                key: "person_name",
                label: "Contact",
                render: (r) => text(r.person_name ?? r.person_username),
              },
              {
                key: "company_name",
                label: "Company",
                render: (r) => text(r.company_name ?? r.company_urn),
              },
              {
                key: "state",
                label: "State",
                render: (r) => <Status value={r.state} />,
              },
              { key: "actionKind", label: "Action" },
              { key: "actionReason", label: "Reason" },
            ]}
          />
          <Records
            rows={api.data.blocked}
            noun="Companies in cooldown"
            columns={[
              {
                key: "company_name",
                label: "Company",
                render: (r) => text(r.company_name ?? r.company_urn),
              },
              { key: "count", label: "Blocked contacts" },
            ]}
          />
        </>
      )}
    </Page>
  )
}
