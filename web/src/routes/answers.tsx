import { Textarea } from "@/components/ui/textarea"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Page,
  LoadState,
  Field,
  controlClass,
} from "@/components/workspace-ui"
import { Records, type Column } from "@/components/records"
import { useApi, request, publish, date, type Row } from "@/lib/api"
const answerColumns: Column[] = [
  { key: "key", label: "Field" },
  { key: "value", label: "Answer" },
  { key: "category", label: "Category" },
  {
    key: "updated_at",
    label: "Updated",
    render: (r) => date(r.updated_at),
  },
]

type AnswerDraft = {
  key: string
  value: string
  category: string
  existing: boolean
}

function AnswerForm({ draft, setDraft, busy, error, duplicate, onSave }: {
  draft: AnswerDraft
  setDraft: (draft: AnswerDraft | null) => void
  busy: boolean
  error: string
  duplicate: boolean
  onSave: () => void
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <Field label="Field key">
        <Input
          required
          value={draft.key}
          disabled={draft.existing || busy}
          placeholder="e.g. preferred_name"
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
        />
      </Field>
      <Field label="Category">
        <Input
          value={draft.category}
          disabled={busy}
          onChange={(e) =>
            setDraft({ ...draft, category: e.target.value })
          }
        />
      </Field>
      <Field label="Answer">
        <Textarea
          className={`${controlClass} h-28 py-2`}
          disabled={busy}
          value={draft.value}
          onChange={(e) =>
            setDraft({ ...draft, value: e.target.value })
          }
        />
      </Field>
      {duplicate && (
        <p className="text-xs text-destructive">
          This key already exists. Open the saved answer to edit it.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setDraft(null)}
        >
          Cancel
        </Button>
        <Button
          disabled={busy || !draft.key.trim() || duplicate}
        >
          {busy ? "Saving…" : "Save answer"}
        </Button>
      </div>
    </form>
  )
}

export function AnswersPage() {
  const api = useApi<Row[]>("answers")
  const [draft, setDraft] = useState<AnswerDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  async function save() {
    if (!draft) return
    setBusy(true)
    setError("")
    try {
      await request("answer", {
        key: draft.key.trim(),
        value: draft.value,
        category: draft.category.trim() || "custom",
      })
      publish({ type: "changed" })
      setDraft(null)
      setNotice("Answer saved.")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page
      title="Answers"
      description="Your reusable details, ready for the next application."
      actions={
        <Button
          size="sm"
          onClick={() => {
            setError("")
            setDraft({
              key: "",
              value: "",
              category: "custom",
              existing: false,
            })
          }}
        >
          Add answer
        </Button>
      }
    >
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <Records
          rows={api.data}
          noun="Saved answers"
          onSelect={(r) => {
            setError("")
            setDraft({
              key: String(r.key),
              value: String(r.value ?? ""),
              category: String(r.category ?? "custom"),
              existing: true,
            })
          }}
          columns={answerColumns}
        />
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft?.existing ? "Edit answer" : "Add an answer"}
            </DialogTitle>
            <DialogDescription>
              Saved answers are available to your application workflows.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <AnswerForm
              draft={draft}
              setDraft={setDraft}
              busy={busy}
              error={error}
              duplicate={!draft.existing && !!api.data?.some((r) => r.key === draft.key.trim())}
              onSave={() => void save()}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  )
}
