import type { ReactNode } from "react"
import { Status } from "@/components/workspace-ui"
import { type Column } from "@/components/records"
import { text, date, type Row } from "@/lib/api"
import { DeadlineBadge } from "@/components/deadline-badge"
import { phaseLabel } from "@/components/application-list"
import { RowGateBadge } from "@/components/gate-badge"
import { RankingScore } from "@/components/job-ranking-action"
import { ResumeMatchBadge } from "@/components/resume-match-detail"
import { linkedApplication } from "@/components/job-list"
import type { AtsBest } from "@/lib/ats"

/** Columns of the Jobs tables; `ats_match` is each job's best resume (see `withAtsMatch`). */
export function jobColumns(actions: (row: Row) => ReactNode, arrived: number[] = []): Column[] {
  return [
    {
      key: "title",
      label: "Opportunity",
      render: (r) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{text(r.title)}</p>
            {arrived.includes(Number(r.id)) && <span className="rounded bg-primary/10 px-2 text-xs text-primary">Just added</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {text(r.company_name)}
          </p>
        </div>
      ),
    },
    { key: "location", label: "Location" },
    { key: "work_type", label: "Work type" },
    {
      key: "fit",
      label: "Fit",
      render: (r) => <Status value={r.fit} />,
    },
    {
      key: "ranking_overall",
      label: "Score",
      render: (r) => <RankingScore row={r} />,
    },
    {
      key: "ats_match",
      label: "Resume match",
      render: (r) => <ResumeMatchBadge match={r.ats_match as AtsBest | undefined} />,
    },
    {
      key: "gate_verdict",
      label: "Requirements",
      render: (r) => <RowGateBadge row={r} />,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <Status value={r.status} />,
    },
    {
      key: "deadline",
      label: "Deadline",
      render: (r) => <DeadlineBadge row={r} />,
    },
    {
      key: "application_phase",
      label: "Application",
      render: (r) =>
        linkedApplication(r) ? <Status value={phaseLabel(r.application_phase)} /> : "—",
    },
    {
      key: "scouted_at",
      label: "Saved",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {date(r.scouted_at)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: actions,
    },
  ]
}
