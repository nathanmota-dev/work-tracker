import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react"
import { useApi, type Row } from "@/lib/api"
import { DEAL_BREAKERS_LINK, gateLabel, jobGatePath, rowVerdict, type GateResult, type GateVerdict, type JobGate } from "@/lib/gates"

const STYLES: Record<GateVerdict, { icon: typeof CircleCheck; className: string }> = {
  fail: { icon: CircleX, className: "border-destructive/50 text-destructive" },
  flag: { icon: TriangleAlert, className: "border-amber-500/60 text-amber-700 dark:text-amber-400" },
  pass: { icon: CircleCheck, className: "border-emerald-600/50 text-emerald-700 dark:text-emerald-400" },
  unchecked: { icon: CircleHelp, className: "text-muted-foreground" },
}

/** Requirement verdict of a job. The word always carries the state, never only the color. */
export function GateBadge({ verdict, unverified = false }: { verdict: GateVerdict; unverified?: boolean }) {
  const { icon: Icon, className } = STYLES[verdict]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs ${className}`}>
      <Icon className="size-3.5" aria-hidden />
      {gateLabel(verdict, unverified)}
    </span>
  )
}

/** The badge of a jobs row (`gate_verdict`, `gate_unverified`). */
export function RowGateBadge({ row }: { row: Row }) {
  return <GateBadge verdict={rowVerdict(row)} unverified={row.gate_unverified === true} />
}

const GATE_NAMES = { language: "Language", eligibility: "Eligibility" } as const

function GateSection({ name, result }: { name: keyof typeof GATE_NAMES; result: GateResult }) {
  return (
    <div>
      <p><span className="font-medium">{GATE_NAMES[name]}: </span>{result.status === "off" ? "Off" : gateLabel(result.status)}. {result.summary}</p>
      {result.status === "off" && <a className="text-xs underline" href={DEAL_BREAKERS_LINK}>Set up deal-breakers</a>}
      {result.findings.length > 0 && (
        <ul className="mt-1 space-y-1">
          {result.findings.map((finding, index) => (
            <li key={index} className="text-xs">
              {finding.note}
              {finding.quote && <> <q className="break-words font-mono">{finding.quote}</q></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Stored requirements check of one job, with the posting text each verdict
 * rests on. Quotes are rendered as plain text, never as markup.
 */
export function GateDetails({ jobId }: { jobId: unknown }) {
  const { data, error } = useApi<JobGate>(jobGatePath(jobId))
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!data) return null
  const gate = data.gate
  return (
    <div role="status" aria-label="Requirements check" className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Requirements</span>
        <GateBadge verdict={gate?.verdict ?? "unchecked"} unverified={gate?.unverified} />
      </p>
      {gate
        ? <>
          <GateSection name="language" result={gate.language} />
          <GateSection name="eligibility" result={gate.eligibility} />
          {gate.verdict === "fail" && <p className="text-xs text-muted-foreground">This job stays saved. You decide whether a deal-breaker applies to you.</p>}
        </>
        : <p className="text-muted-foreground">Check requirements to compare the languages and eligibility this job asks for with your <a className="underline" href={DEAL_BREAKERS_LINK}>deal-breakers</a>.</p>}
    </div>
  )
}
