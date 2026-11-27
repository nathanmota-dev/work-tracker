import { useCallback, useEffect, useState } from "react"
import { readVariantLatex, saveVariantLatex, type VariantLatexFile } from "@/lib/variants"

/** One `file:line: message` error of a LaTeX compilation. */
export type LatexError = { file: string; line: number; message: string }
export type LatexStatus = "loading" | "ready" | "missing" | "error"

const NO_SOURCE = /no LaTeX source/i
/** The backend saves the files before compiling, so a compilation error still saved them. */
const SAVED_ANYWAY = /Your changes are saved/

/** The `file:line: message` lines of a compilation error, with `./` removed from the file. */
export function parseLatexErrors(message: string): LatexError[] {
  return message.split("\n").flatMap(line => {
    const match = /^(?:\.\/)?([^\s:]+\.tex):(\d+): (.+)$/.exec(line.trim())
    return match ? [{ file: match[1]!, line: Number(match[2]), message: match[3]! }] : []
  })
}

const texts = (files: VariantLatexFile[]) => Object.fromEntries(files.map(file => [file.name, file.text]))

/**
 * The LaTeX files of a saved resume, loaded once so a refresh never replaces
 * what is being typed, with their edits and the last save's error.
 */
export function useResumeLatex(id: string) {
  const [files, setFiles] = useState<VariantLatexFile[]>([])
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [active, setActive] = useState("")
  const [status, setStatus] = useState<LatexStatus>("loading")
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setStatus("loading"); setLoadError(""); setFailure("")
    readVariantLatex(id).then(latex => {
      if (!current) return
      setFiles(latex.files); setSaved(texts(latex.files)); setActive(latex.mainFile); setStatus("ready")
    }).catch((error: Error) => {
      if (!current) return
      setStatus(NO_SOURCE.test(error.message) ? "missing" : "error"); setLoadError(error.message)
    })
    return () => { current = false }
  }, [id, attempt])
  const changed = files.filter(file => file.text !== saved[file.name])
  const dirty = changed.length > 0
  const edit = useCallback((name: string, text: string) => {
    setFiles(list => list.map(file => file.name === name ? { ...file, text } : file))
  }, [])
  /** Save the changed files; resolves false when the resume did not compile. */
  async function save(): Promise<boolean> {
    if (!dirty || saving) return false
    setSaving(true); setFailure("")
    try {
      await saveVariantLatex(id, changed)
      setSaved(texts(files))
      return true
    } catch (error) {
      const message = (error as Error).message
      if (SAVED_ANYWAY.test(message)) setSaved(texts(files))
      setFailure(message)
      return false
    } finally { setSaving(false) }
  }
  return {
    files, active, setActive, status, loadError, saving, failure, dirty, edit, save,
    errors: parseLatexErrors(failure),
    isChanged: (name: string) => changed.some(file => file.name === name),
    retry: () => setAttempt(value => value + 1),
  }
}
export type ResumeLatex = ReturnType<typeof useResumeLatex>
