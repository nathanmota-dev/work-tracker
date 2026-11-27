import { useState } from "react"
import { Download, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { JOB_FIELDS, type ImportedJob, type JobField } from "@/components/job-draft"
import { request } from "@/lib/api"

/** Reads one job page at a time and reports what it filled. */
export function useJobImport(onImported: (previous: ImportedJob | null, next: ImportedJob) => void) {
  const [imported, setImported] = useState<ImportedJob | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState("")
  async function run(url: string) {
    if (!url.trim() || importing) return
    setImporting(true)
    setError("")
    try {
      const next = await request<ImportedJob>("jobs/import", { url: url.trim() })
      onImported(imported, next)
      setImported(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }
  return { imported, importing, error, run }
}

function summary(imported: ImportedJob): string {
  const filled = (Object.keys(imported.fields) as JobField[]).map(key => JOB_FIELDS[key].toLowerCase())
  return `Imported ${filled.join(", ")}. Review before saving.`
}

/** The job link; with `importer`, a button fills the form from the page behind it. */
export function JobLinkField({ value, onChange, importer }: {
  value: string
  onChange: (value: string) => void
  importer?: ReturnType<typeof useJobImport>
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-xs font-medium">
          {JOB_FIELDS.link}
          <Input type="url" value={value} disabled={importer?.importing} onChange={e => onChange(e.target.value)}
            placeholder={importer ? "Paste the job link" : undefined}
            onKeyDown={e => {
              if (!importer || e.key !== "Enter") return
              e.preventDefault()
              void importer.run(value)
            }} />
        </label>
        {importer && (
          <Button type="button" variant="secondary" disabled={!value.trim() || importer.importing} onClick={() => void importer.run(value)}>
            {importer.importing ? <LoaderCircle className="animate-spin" /> : <Download />}
            {importer.importing ? "Importing…" : "Import"}
          </Button>
        )}
      </div>
      {importer && (
        <>
          {importer.error ? <p role="alert" className="text-xs text-destructive">{importer.error}</p> : (
            <p role="status" className="text-xs text-muted-foreground">
              {importer.imported ? summary(importer.imported) : "Import fills the fields from the job page. You can also type them."}
            </p>
          )}
        </>
      )}
    </div>
  )
}
