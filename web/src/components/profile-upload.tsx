import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { UPLOAD_ACCEPT, uploadProfileFile } from "@/lib/profile-sources"

const list = (files: string[]) => files.join(", ")
function summary(added: string[], present: string[]): string {
  return [added.length ? `Added ${list(added)}.` : "", present.length ? `Already in your profile: ${list(present)}.` : ""].filter(Boolean).join(" ")
}

/**
 * Copies PDFs and the resume data file into the profile folder, as placing
 * them there by hand does. Different resume data is only replaced after a
 * confirmation.
 */
export function ProfileUpload({ disabled, onUploaded }: { disabled: boolean; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState(false)
  const [replacing, setReplacing] = useState<File | null>(null)
  const [notice, setNotice] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  async function send(files: File[], replace = false) {
    setWorking(true); setNotice(""); setErrors([])
    const added: string[] = [], present: string[] = [], failed: string[] = []
    for (const file of files) {
      try {
        const { upload } = await uploadProfileFile(file, replace)
        if (upload.status === "replace_required") setReplacing(file)
        else (upload.status === "added" ? added : present).push(upload.file)
      } catch (e) { failed.push(`${file.name}: ${(e as Error).message}`) }
    }
    setWorking(false); setNotice(summary(added, present)); setErrors(failed)
    if (added.length || present.length) onUploaded()
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={disabled || working} onClick={() => input.current?.click()}>{working ? "Adding…" : "Add files"}</Button>
      <span className="text-xs text-muted-foreground">Resume PDF, LinkedIn PDF or resume-data.json</span>
      <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" aria-label="Choose profile files" onChange={e => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ""
        if (files.length) void send(files)
      }} />
    </div>
    {replacing && <div role="alertdialog" aria-label="Replace resume data" className="space-y-2 rounded-lg border p-3 text-sm">
      <p>Your profile already has different resume data. Replace it with {replacing.name}?</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={working} onClick={() => { const file = replacing; setReplacing(null); void send([file], true) }}>Replace</Button>
        <Button type="button" size="sm" variant="outline" disabled={working} onClick={() => setReplacing(null)}>Keep current</Button>
      </div>
    </div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {errors.map(error => <p key={error} role="alert" className="text-sm text-destructive">{error}</p>)}
  </div>
}
