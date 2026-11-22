import { Markdown } from "@/components/markdown"
import { Empty, LoadState } from "@/components/workspace-ui"
import { date, text, useApi, type Row } from "@/lib/api"

/** Stored preparation packs of one application, newest first. */
export function InterviewPrepPacks({ applicationId }: { applicationId: number }) {
  const api = useApi<Row[]>(`interview-preps/${applicationId}`)
  return (
    <>
      <LoadState {...api} retry={api.refresh} />
      {api.data && <PackList packs={api.data} />}
    </>
  )
}

function PackList({ packs }: { packs: Row[] }) {
  if (!packs.length) {
    return <Empty title="No preparation pack yet" description="Run the agent to build one for this application." />
  }
  return (
    <div className="flex flex-col gap-3">
      {packs.map((pack, index) => (
        <details key={String(pack.id)} className="rounded-xl border px-4 py-3" open={index === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {text(pack.stage)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {pack.scheduled_at ? date(pack.scheduled_at) : `Saved ${date(pack.created_at)}`}
            </span>
          </summary>
          <div className="mt-3 text-sm">
            <Markdown text={String(pack.body_md ?? "")} />
          </div>
        </details>
      ))}
    </div>
  )
}
