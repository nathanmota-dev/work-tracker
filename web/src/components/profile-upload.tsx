import { useRef, useState, type DragEvent } from "react"
import { CircleAlert, CircleCheck, FileJson, FileText, LoaderCircle, Upload, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { UPLOAD_ACCEPT, uploadProfileFile } from "@/lib/profile-sources"

type Status = "uploading" | "added" | "unchanged" | "replace" | "failed"
/** One file the user chose, as the upload list shows it. */
interface Item { id: number; file: File; status: Status; message: string }

export const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const accepted = (file: File) => /\.(pdf|json)$/i.test(file.name)

function StatusLine({ item }: { item: Item }) {
  if (item.status === "uploading") return <span className="flex items-center gap-1.5 text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Uploading…</span>
  if (item.status === "failed") return <span className="flex items-center gap-1.5 text-destructive"><CircleAlert className="size-3.5" />{item.message}</span>
  if (item.status === "replace") return <span className="text-amber-600 dark:text-amber-400">{item.message}</span>
  return <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><CircleCheck className="size-3.5" />{item.status === "added" ? "Uploaded" : "Already in your profile"}</span>
}

function UploadRow({ item, busy, replace, keep, remove }: { item: Item; busy: boolean; replace: () => void; keep: () => void; remove: () => void }) {
  const Icon = /\.json$/i.test(item.file.name) ? FileJson : FileText
  return <li className={cn("rounded-lg border bg-card p-3 text-sm", item.status === "replace" && "border-amber-500/60 bg-amber-500/5")}>
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="size-5 text-muted-foreground" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.file.name}>{item.file.name}</p>
        <div className="flex flex-wrap items-center gap-x-2 text-xs"><span className="text-muted-foreground">{fileSize(item.file.size)}</span><StatusLine item={item} /></div>
      </div>
      {item.status !== "uploading" && <Button type="button" size="icon" variant="ghost" className="size-7 text-muted-foreground" aria-label={`Remove ${item.file.name} from the list`} onClick={remove}><X /></Button>}
    </div>
    {item.status === "replace" && <div role="alertdialog" aria-label="Replace profile source" className="mt-3 flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={replace}>Replace</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={keep}>Keep current</Button>
    </div>}
  </li>
}

/**
 * Drop zone and upload list of the profile's files. Resume data and the
 * LinkedIn export are the profile itself: one replaces the other only after
 * the user confirms it on the uploaded file.
 */
export function ProfileUpload({ disabled, onUploaded }: { disabled: boolean; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const next = useRef(0)
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const busy = items.some(item => item.status === "uploading")
  const update = (id: number, patch: Partial<Item>) => setItems(list => list.map(item => item.id === id ? { ...item, ...patch } : item))
  async function upload(item: Item, replace = false) {
    update(item.id, { status: "uploading", message: "" })
    try {
      const { upload: result } = await uploadProfileFile(item.file, replace)
      if (result.status === "replace_required") update(item.id, { status: "replace", message: `Your profile is built from ${result.replaces || "another file"}. Replace it with this file? The current file is removed and your base resume is rebuilt.` })
      else { update(item.id, { status: result.status }); onUploaded() }
    } catch (e) { update(item.id, { status: "failed", message: (e as Error).message }) }
  }
  async function add(files: File[]) {
    const chosen = files.map(file => ({ id: next.current++, file, status: "uploading" as Status, message: "" }))
    setItems(list => [...chosen.map(item => accepted(item.file) ? item : { ...item, status: "failed" as Status, message: "Choose a PDF or a .json resume data file." }), ...list])
    for (const item of chosen) if (accepted(item.file)) await upload(item)
  }
  function drop(event: DragEvent) {
    event.preventDefault(); setDragging(false)
    if (!disabled) void add(Array.from(event.dataTransfer.files))
  }
  const completed = items.filter(item => item.status === "added" || item.status === "unchanged").length
  return <div className="space-y-4">
    <div role="button" tabIndex={disabled ? -1 : 0} aria-label="Upload profile files" aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()} onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); input.current?.click() } }}
      onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}
      className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring", dragging && "border-primary bg-accent/40", disabled && "pointer-events-none opacity-60")}>
      <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted"><Upload className="size-5" /></span>
      <p className="font-medium">Upload your resume</p>
      <p className="text-sm text-muted-foreground">Drag and drop files here or click to browse</p>
      <p className="text-xs text-muted-foreground">Resume data (.json) or LinkedIn PDF, plus other resume PDFs · up to 20 MB each</p>
      <Button type="button" size="sm" variant="secondary" className="mt-2" tabIndex={-1}><Upload />Select files</Button>
      <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" aria-label="Choose profile files" onClick={e => e.stopPropagation()} onChange={e => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ""
        if (files.length) void add(files)
      }} />
    </div>
    {items.length > 0 && <section aria-label="Upload progress" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">Upload progress<Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">Completed: {completed}</Badge></p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setItems([])}>Clear all</Button>
      </div>
      <ul className="space-y-2">{items.map(item => <UploadRow key={item.id} item={item} busy={busy}
        replace={() => void upload(item, true)} keep={() => setItems(list => list.filter(other => other.id !== item.id))} remove={() => setItems(list => list.filter(other => other.id !== item.id))} />)}</ul>
    </section>}
  </div>
}
