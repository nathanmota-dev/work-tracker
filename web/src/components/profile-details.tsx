import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadState, Panel } from "@/components/workspace-ui"
import { publish, request, useApi, type Row } from "@/lib/api"
import { PROFILE_SECTIONS, profileValue, syncProfileOnce } from "@/lib/profile-details"
import { useProfileSources, type ProfileSourcesState } from "@/lib/profile-sources"
import { useWorkspaceState } from "@/lib/workspace-state"
import { ANSWER_CATALOG } from "../../../src/answers/catalog"

const label = (key: string) => ANSWER_CATALOG.find(spec => spec.key === key)?.label ?? key

function FieldRow({ field, rows, manual, edit }: { field: string; rows: Row[]; manual?: boolean; edit: (key: string) => void }) {
  const { value, origin } = profileValue(rows, field)
  return <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 last:border-0">
    <span className="w-40 shrink-0 text-sm text-muted-foreground">{label(field)}</span>
    <span className="min-w-0 flex-1 text-sm break-words">
      {value || <span className="text-muted-foreground">{manual ? "Add your answer before applying" : "Not found in your resume — add it"}</span>}
    </span>
    {origin && <Badge variant="outline">{origin}</Badge>}
    <Button size="sm" variant="ghost" aria-label={`Edit ${label(field)}`} onClick={() => edit(field)}>{value ? "Edit" : "Add"}</Button>
  </li>
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return <div><h4 className="mb-2 text-sm font-medium">{title}</h4>
    <ul className="flex flex-wrap gap-2" aria-label={title}>{items.map(item => <li key={item}><Badge variant="secondary">{item}</Badge></li>)}</ul>
  </div>
}

/** Headline, summary, skills, languages and certifications as the sources state them; edited at the source. */
function About({ about }: { about: NonNullable<ProfileSourcesState["about"]> }) {
  return <Panel title="About you">
    <div className="space-y-4">
      {about.headline && <p className="font-medium">{about.headline}</p>}
      {about.summary && <p className="text-sm leading-relaxed text-muted-foreground">{about.summary}</p>}
      <List title="Skills" items={about.skills} />
      <List title="Languages" items={about.languages.map(language => [language.name, language.level].filter(Boolean).join(" · "))} />
      <List title="Certifications" items={about.certifications} />
      <p className="text-xs text-muted-foreground">Read from your LinkedIn export and data file. Update them there and import again.</p>
    </div>
  </Panel>
}

/**
 * Everything the resume sources say about the candidate, by section. Opening
 * it imports new PDFs and fills empty answers; editing a field opens it in Answers.
 */
export function ProfileDetails() {
  const answers = useApi<Row[]>("answers/variants")
  const sources = useProfileSources()
  const { update } = useWorkspaceState("profile")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const refreshSources = sources.refresh
  useEffect(() => { void syncProfileOnce().then(state => { if (state) refreshSources() }) }, [refreshSources])
  async function importAgain() {
    setBusy(true); setError("")
    try { await request("profile-sources/import", {}); publish({ type: "changed", table: "applicant_answers" }); refreshSources() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const edit = (field: string) => update({ tab: "answers", field })
  const rows = answers.data ?? []
  return <>
    <Panel title="Your details" action={<Button size="sm" variant="outline" disabled={busy} onClick={() => void importAgain()}>{busy ? "Updating…" : "Update from resume"}</Button>}>
      <p className="mb-4 text-sm text-muted-foreground">Filled from your resume sources: the data file, your LinkedIn export and your resume PDFs. Applications use these answers. Your own edits are never replaced.</p>
      <LoadState loading={answers.loading && !answers.data} error={answers.error} retry={answers.refresh} />
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {answers.data && <div className="space-y-6">
        {PROFILE_SECTIONS.map(section => <section key={section.title} aria-label={section.title}>
          <h3 className="font-medium">{section.title}</h3>
          {section.manual && <p className="mt-1 text-xs text-muted-foreground">Resumes do not include these, but portals often ask for them. Gender, race, veteran and disability questions are always left for you to answer.</p>}
          <ul>{section.keys.map(field => <FieldRow key={field} field={field} rows={rows} manual={section.manual} edit={edit} />)}</ul>
        </section>)}
      </div>}
    </Panel>
    {sources.data?.about && <About about={sources.data.about} />}
  </>
}
