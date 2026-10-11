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
  Records,
  LoadState,
  Field,
  controlClass,
} from "@/components/workspace-ui"
import { useApi, request, publish, date, type Row } from "@/lib/api"
export function AnswersPage() {
  const api = useApi<Row[]>("answers")
  const [draft, setDraft] = useState<{
    key: string
    value: string
    category: string
    existing: boolean
  } | null>(null)
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
          columns={[
            { key: "key", label: "Field" },
            { key: "value", label: "Answer" },
            { key: "category", label: "Category" },
            {
              key: "updated_at",
              label: "Updated",
              render: (r) => date(r.updated_at),
            },
          ]}
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
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
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
              {!draft.existing &&
                api.data?.some((r) => r.key === draft.key.trim()) && (
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
                  disabled={
                    busy ||
                    !draft.key.trim() ||
                    (!draft.existing &&
                      api.data?.some((r) => r.key === draft.key.trim()))
                  }
                >
                  {busy ? "Saving…" : "Save answer"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  )
}
