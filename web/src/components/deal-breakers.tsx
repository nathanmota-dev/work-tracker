import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, LoadState, Page, Panel } from "@/components/workspace-ui"
import { useApi } from "@/lib/api"
import {
  ELIGIBILITY_LABELS, GATE_PROFILE_PATH, gatesOff, removeLanguage, saveLanguage, setEligibility,
  type CandidateLanguage, type Eligibility, type GateProfile,
} from "@/lib/gates"

type Run = (change: () => Promise<GateProfile>) => Promise<boolean>

function AddLanguage({ busy, run }: { busy: boolean; run: Run }) {
  const [draft, setDraft] = useState({ language: "", level: "", notes: "" })
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await run(() => saveLanguage(draft))) setDraft({ language: "", level: "", notes: "" })
  }
  return (
    <form className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end" onSubmit={e => void submit(e)}>
      <Field label="Language"><Input value={draft.language} disabled={busy} placeholder="Spanish" onChange={e => setDraft({ ...draft, language: e.target.value })} /></Field>
      <Field label="Level"><Input value={draft.level} disabled={busy} placeholder="Native, C1, B1/B2 (conversational)" onChange={e => setDraft({ ...draft, level: e.target.value })} /></Field>
      <Field label="Notes"><Input value={draft.notes} disabled={busy} placeholder="Optional" onChange={e => setDraft({ ...draft, notes: e.target.value })} /></Field>
      <Button type="submit" size="sm" disabled={busy || !draft.language.trim() || !draft.level.trim()}>Add language</Button>
    </form>
  )
}

function LanguageRow({ item, busy, run }: { item: CandidateLanguage; busy: boolean; run: Run }) {
  const [level, setLevel] = useState<string | null>(null)
  async function save() {
    if (await run(() => saveLanguage({ id: item.id, language: item.language, level: level ?? item.level, notes: item.notes ?? "" }))) setLevel(null)
  }
  return (
    <li className="flex flex-wrap items-center gap-3 border-b py-2 last:border-0">
      <span className="min-w-28 font-medium">{item.language}</span>
      {level === null
        ? <span className="flex-1">{item.level}{item.notes && <span className="text-muted-foreground"> · {item.notes}</span>}</span>
        : <Input className="h-8 max-w-60 flex-1" aria-label={`Level of ${item.language}`} value={level} disabled={busy} onChange={e => setLevel(e.target.value)} />}
      {level === null
        ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setLevel(item.level)}>Edit level</Button>
        : <>
          <Button size="sm" disabled={busy || !level.trim()} onClick={() => void save()}>Save level</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLevel(null)}>Cancel</Button>
        </>}
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`Remove ${item.language}`} onClick={() => void run(() => removeLanguage(item.id))}>Remove</Button>
    </li>
  )
}

function EligibilityPicker({ value, busy, run }: { value: Eligibility | null; busy: boolean; run: Run }) {
  return (
    <fieldset className="space-y-2 text-sm" disabled={busy}>
      <legend className="sr-only">Work eligibility</legend>
      {(Object.keys(ELIGIBILITY_LABELS) as (Eligibility | "none")[]).map(option => (
        <label key={option} className="flex items-center gap-2">
          <input type="radio" name="eligibility" checked={(value ?? "none") === option}
            onChange={() => void run(() => setEligibility(option === "none" ? null : option))} />
          {ELIGIBILITY_LABELS[option]}
        </label>
      ))}
      <p className="text-xs text-muted-foreground">If you need a visa or work permit, jobs that require citizenship, permanent residency or a security clearance fail, and jobs that say nothing pass unverified: silence is not permission. Not set turns this gate off.</p>
    </fieldset>
  )
}

/** Languages and work eligibility that the requirements check compares each job with. */
export function DealBreakers() {
  const profile = useApi<GateProfile>(GATE_PROFILE_PATH)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const run: Run = async change => {
    setBusy(true)
    setError("")
    try { await change(); profile.refresh(); return true }
    catch (e) { setError((e as Error).message); return false }
    finally { setBusy(false) }
  }
  const languages = profile.data?.languages ?? []
  return (
    <Page title="Deal-breakers" description="Requirements no application can work around. The requirements check warns and filters; it never decides for you or deletes a job.">
      <LoadState loading={profile.loading && !profile.data} error={profile.error} retry={profile.refresh} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {gatesOff(profile.data) && <p role="status" className="rounded-lg border p-3 text-sm">Both gates are off, so no job fails. Add the languages you work in or set your work eligibility to turn them on, then run Check requirements on your jobs.</p>}
      {profile.data && <>
        <Panel title="Languages you work in">
          <p className="text-sm text-muted-foreground">An undeclared language counts as a hard no: a job that requires it fails. A job that asks for a higher level than yours is flagged, not failed.</p>
          {languages.length > 0
            ? <ul className="mt-3 text-sm" aria-label="Declared languages">{languages.map(item => <LanguageRow key={item.id} item={item} busy={busy} run={run} />)}</ul>
            : <p className="mt-3 text-sm">No languages yet. Add your languages to enable the language gate.</p>}
          <AddLanguage busy={busy} run={run} />
        </Panel>
        <Panel title="Work eligibility"><EligibilityPicker value={profile.data.eligibility} busy={busy} run={run} /></Panel>
      </>}
    </Page>
  )
}
