import { useState } from "react"
import { Button } from "@/components/ui/button"
import { request, useApi } from "@/lib/api"

type Lookup = { found: boolean; fresh: boolean; age_days: number | null }

function age(days: number | null) {
  if (days === null) return "on an unknown date"
  if (days === 0) return "today"
  return days === 1 ? "1 day ago" : `${days} days ago`
}

/** One discreet line about the company research the interview-prep skill cached, with a way to force a new one. */
export function CompanyResearchNote({ company }: { company: string }) {
  const api = useApi<Lookup>(`company-research?company=${encodeURIComponent(company)}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function refresh() {
    setBusy(true)
    setError("")
    try {
      await request("company-research/invalidate", { company })
      api.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!api.data?.found) return null
  return (
    <div className="text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-1">
        <span>Company research cached {age(api.data.age_days)}{api.data.fresh ? "" : " (expired)"}</span>
        <span aria-hidden="true">·</span>
        <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </Button>
      </p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
