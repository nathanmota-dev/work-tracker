import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SelectControl } from "@/components/ui/select-control"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field } from "@/components/workspace-ui"
import {
  boardAction,
  STAGE_CATEGORIES,
  type ApplicationStage,
  type StageCategory,
} from "@/lib/application-board"

function StageRow({
  stage,
  name,
  index,
  visibleCount,
  busy,
  onRename,
  onSave,
  onMove,
  onToggleArchived,
}: {
  stage: ApplicationStage
  name: string
  index: number
  visibleCount: number
  busy: boolean
  onRename: (name: string) => void
  onSave: () => void
  onMove: (offset: number) => void
  onToggleArchived: () => void
}) {
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <div className="min-w-32 flex-1">
        <Input
          aria-label={`Name for ${stage.name}`}
          value={name}
          disabled={busy}
          onChange={(e) => onRename(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {STAGE_CATEGORIES[stage.category]}
          {stage.is_archived ? " · Hidden" : ""}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        disabled={busy || !name.trim()}
        aria-label={`Save ${stage.name} name`}
      >
        <Save className="size-4" />
      </Button>
      {!stage.is_archived && (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy || index === 0}
            aria-label={`Move ${stage.name} up`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy || index === visibleCount - 1}
            aria-label={`Move ${stage.name} down`}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" />
          </Button>
        </>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={busy || stage.key === "applied"}
        aria-label={`${stage.is_archived ? "Restore" : "Hide"} ${stage.name}`}
        onClick={onToggleArchived}
      >
        {stage.is_archived ? (
          <Eye className="size-4" />
        ) : (
          <EyeOff className="size-4" />
        )}
      </Button>
    </form>
  )
}

function NewStageForm({
  busy,
  onAdd,
}: {
  busy: boolean
  onAdd: (name: string, category: StageCategory, reset: () => void) => void
}) {
  const [name, setName] = useState("")
  const [category, setCategory] = useState<StageCategory>("assessment")
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        onAdd(name, category, () => setName(""))
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New stage name">
          <Input
            required
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. DSA or Logic test"
          />
        </Field>
        <Field label="Stage category">
          <SelectControl
            aria-label="Stage category"
            value={category}
            disabled={busy}
            onChange={(e) => setCategory(e.target.value as StageCategory)}
          >
            {Object.entries(STAGE_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectControl>
        </Field>
      </div>
      <Button disabled={busy || !name.trim()} size="sm">
        <Plus className="size-4" />
        Add stage
      </Button>
    </form>
  )
}

function useStageManager(stages: ApplicationStage[], onChanged: () => void) {
  const [items, setItems] = useState(stages)
  const [names, setNames] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => setItems(stages), [stages])
  async function perform(work: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await work()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function replace(saved: ApplicationStage) {
    setItems((previous) =>
      previous.map((item) => (item.id === saved.id ? saved : item)),
    )
  }
  const visible = items.filter((item) => !item.is_archived)
  function reorder(index: number, offset: number) {
    const ids = visible.map((item) => item.id)
    ;[ids[index], ids[index + offset]] = [ids[index + offset], ids[index]]
    void perform(async () =>
      setItems(await boardAction("stages/reorder", { ids })),
    )
  }
  function addStage(name: string, category: StageCategory, reset: () => void) {
    void perform(async () => {
      const saved = await boardAction("stages/save", { name, category })
      setItems((previous) => [...previous, saved])
      reset()
    })
  }
  function saveName(stage: ApplicationStage, name: string) {
    void perform(async () =>
      replace(await boardAction("stages/save", { id: stage.id, name })),
    )
  }
  function toggleArchived(stage: ApplicationStage) {
    void perform(async () =>
      replace(
        await boardAction("stages/set-archived", {
          id: stage.id,
          archived: !stage.is_archived,
        }),
      ),
    )
  }
  return { items, names, setNames, busy, error, visible, reorder, addStage, saveName, toggleArchived }
}

export function ApplicationStages({
  stages,
  onClose,
  onChanged,
}: {
  stages: ApplicationStage[]
  onClose: () => void
  onChanged: () => void
}) {
  const { items, names, setNames, busy, error, visible, reorder, addStage, saveName, toggleArchived } =
    useStageManager(stages, onChanged)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>Manage stages</DialogTitle>
          <DialogDescription>
            Create extra rounds, rename columns and change their order.
            Categories stay fixed so your progress remains comparable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {items.map((stage) => {
            const name = names[stage.id] ?? stage.name
            const index = visible.findIndex((item) => item.id === stage.id)
            return (
              <StageRow
                key={stage.id}
                stage={stage}
                name={name}
                index={index}
                visibleCount={visible.length}
                busy={busy}
                onRename={(value) =>
                  setNames((previous) => ({ ...previous, [stage.id]: value }))
                }
                onSave={() => saveName(stage, name)}
                onMove={(offset) => reorder(index, offset)}
                onToggleArchived={() => toggleArchived(stage)}
              />
            )
          })}
        </div>
        <NewStageForm busy={busy} onAdd={addStage} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
