import { Panel } from "@/components/workspace-ui"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SOURCE_LABELS } from "@/lib/profile-details"
import { ANSWER_CATALOG, CATEGORY_LABELS, answerEntries, answerInput, resolveAnswer, type AnswerValue } from "../../../src/answers/catalog"
import type { PersonalSource } from "../../../src/profile/types"

/** `source` is the resume source that filled the default answer, if it still holds that value. */
export type CatalogRow = AnswerValue & { source?: PersonalSource | null }

/** Several values show as chips, a long text is clipped, anything else as typed. */
function Value({ value, kind }: { value: string; kind: string }) {
  if (kind === "tags" || kind === "multiselect")
    return <ul className="flex flex-wrap gap-1">{answerEntries(value).map(item => <li key={item}><Badge variant="secondary" className="h-auto whitespace-normal break-words py-0.5 text-[11px]">{item}</Badge></li>)}</ul>
  return <span className={kind === "textarea" ? "line-clamp-3" : ""}>{value}</span>
}

function Status({ required, humanOnly, status, source, fallback }: { required: boolean; humanOnly: boolean; status: string; source?: string; fallback?: string }) {
  if (status === "invalid") return <Badge variant="destructive">Invalid — correct it</Badge>
  if (status === "missing") return humanOnly ? <Badge variant="outline">Human review only</Badge> : <Badge variant={required ? "destructive" : "outline"}>{required ? "Required — add it" : "Not set"}</Badge>
  return <Badge variant="secondary">{humanOnly ? "Saved · never auto-filled" : fallback ? `Fallback: ${fallback}` : source ?? "Added by you"}</Badge>
}

/** One table per category with the saved value of every catalog field; a row opens its editor. */
export function AnswerTables({ rows, language, fallback, onEdit }: {
  rows: CatalogRow[]; language: string; fallback: string
  onEdit: (key: string, language: string) => void
}) {
  return <>
    {Object.entries(CATEGORY_LABELS).filter(([category]) => category !== "custom").map(([category, label]) => <Panel key={category} title={label}>
      <div className="overflow-x-auto">
        <Table className="w-full text-left text-sm" aria-label={label}>
          <TableHeader>
            <TableRow className="border-b">
              {["Field", "Answer", "Status", "Other languages"].map(name => <TableHead key={name} className="px-3 py-3 text-xs font-normal text-muted-foreground">{name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ANSWER_CATALOG.filter(spec => spec.category === category).map(spec => {
              let resolution: ReturnType<typeof resolveAnswer> = { status: "missing", fallback: false }
              try { resolution = resolveAnswer(rows, spec.key, language, fallback || undefined) } catch { /* invalid selector is explained above */ }
              const shown = resolution.value ?? ""
              const lang = resolution.language ?? language
              const source = rows.find(row => row.key === spec.key && (row.language ?? "default") === lang)?.source
              const others = rows.filter(row => row.key === spec.key && (row.language ?? "default") !== "default" && row.value?.trim()).map(row => row.language)
              const open = () => onEdit(spec.key, lang)
              return <TableRow key={spec.key} className="cursor-pointer border-b last:border-0 hover:bg-muted/30" onClick={open}>
                <TableCell className="px-3 py-3 align-top">
                  <button type="button" className="text-left font-medium underline-offset-2 hover:underline" aria-label={`${spec.label}${spec.required ? " · Required" : ""}`}
                    onClick={event => { event.stopPropagation(); open() }}>{spec.label}{spec.required ? " *" : ""}</button>
                </TableCell>
                <TableCell className="max-w-96 px-3 py-3 align-top break-words">{shown ? <Value value={shown} kind={answerInput(spec.key).kind} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="px-3 py-3 align-top">
                  <Status required={spec.required} humanOnly={spec.humanOnly} status={resolution.status}
                    source={source && SOURCE_LABELS[source] ? SOURCE_LABELS[source] : undefined} fallback={resolution.fallback ? resolution.language : undefined} />
                </TableCell>
                <TableCell className="px-3 py-3 align-top text-muted-foreground">{others.join(", ") || "—"}</TableCell>
              </TableRow>
            })}
          </TableBody>
        </Table>
      </div>
    </Panel>)}
  </>
}
