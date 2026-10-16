import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, LoadState, Panel } from "@/components/workspace-ui"
import { useApi, type Row } from "@/lib/api"
import {
  candidateFromAnswers,
  emptyProfile,
  linkedinUsername,
  saveCandidateProfile,
  type CandidateProfile,
} from "@/lib/candidate-profile"

type ChangeField = (key: keyof CandidateProfile, value: string) => void

function ProfileFields({ draft, busy, change }: { draft: CandidateProfile; busy: boolean; change: ChangeField }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input
            autoComplete="given-name"
            value={draft.firstName}
            disabled={busy}
            onChange={(e) => change("firstName", e.target.value)}
            placeholder="Your first name"
          />
        </Field>
        <Field label="Last name">
          <Input
            autoComplete="family-name"
            value={draft.lastName}
            disabled={busy}
            onChange={(e) => change("lastName", e.target.value)}
            placeholder="Your last name"
          />
        </Field>
      </div>
      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          value={draft.email}
          disabled={busy}
          onChange={(e) => change("email", e.target.value)}
          placeholder="you@example.com"
        />
      </Field>
      <Field label="LinkedIn username">
        <Input
          autoComplete="off"
          value={draft.linkedinUsername}
          disabled={busy}
          onChange={(e) => change("linkedinUsername", e.target.value)}
          placeholder="your-name or linkedin.com/in/your-name"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Paste your username or your full LinkedIn profile URL.
      </p>
    </>
  )
}

function ProfileSharingPanel() {
  return (
  <Panel title="One profile, everywhere">
    <div className="mb-4 inline-flex rounded-xl border bg-muted/30 p-3">
      <UserRound className="size-5 text-muted-foreground" />
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Your LinkedIn username is filled in for profile audits. Your name and
      contact details are available when tailoring resumes and preparing
      applications.
    </p>
    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
      These details are shared with your{" "}
      <Link
        to="/answers"
        className="text-foreground underline underline-offset-4"
      >
        saved answers
      </Link>
      , so changes in either place stay in sync.
    </p>
  </Panel>
  )
}

export function SettingsProfile() {
  const api = useApi<Row[]>("answers")
  const [draft, setDraft] = useState<CandidateProfile>(emptyProfile)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (api.data && !dirty && !busy) setDraft(candidateFromAnswers(api.data))
  }, [api.data, dirty, busy])
  function change(key: keyof CandidateProfile, value: string) {
    setDraft((p) => ({ ...p, [key]: value }))
    setDirty(true)
    setSaved(false)
    setError("")
  }
  async function save() {
    setError("")
    setSaved(false)
    let username: string
    try {
      username = linkedinUsername(draft.linkedinUsername)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setBusy(true)
    try {
      await saveCandidateProfile({ ...draft, linkedinUsername: username })
      setDraft((p) => ({ ...p, linkedinUsername: username }))
      setDirty(false)
      setSaved(true)
      api.refresh()
    } catch (e) {
      setError(
        `Some fields may already be saved. Your edits are preserved; retry to finish saving. ${(e as Error).message}`,
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="Personal details">
        <p className="mb-5 text-sm text-muted-foreground">
          Set your details once. We’ll use them across your workspace.
        </p>
        <LoadState
          loading={api.loading && !api.data}
          error={api.error}
          retry={api.refresh}
        />
        {api.data && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <ProfileFields draft={draft} busy={busy} change={change} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="text-sm text-muted-foreground">
                Profile saved. Your details are ready to use across the app.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || !dirty}
                onClick={() => {
                  setDraft(candidateFromAnswers(api.data ?? []))
                  setDirty(false)
                  setError("")
                  setSaved(false)
                }}
              >
                Discard changes
              </Button>
              <Button disabled={busy || !dirty}>
                {busy ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        )}
      </Panel>
      <ProfileSharingPanel />
    </div>
  )
}
