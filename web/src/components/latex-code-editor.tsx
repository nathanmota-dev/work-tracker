import { useEffect, useMemo, useRef, useState } from "react"
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { StreamLanguage } from "@codemirror/language"
import { stex } from "@codemirror/legacy-modes/mode/stex"

const base = [
  StreamLanguage.define(stex),
  EditorView.lineWrapping,
  EditorView.theme({
    "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
    ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--border)" },
  }),
]

/** Follows the app theme, which toggles the `dark` class on the document. */
function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains("dark")))
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/**
 * A LaTeX code editor filling its container.
 *
 * @param focus Moves the cursor to this line whenever the object changes.
 */
export function LatexCodeEditor({ label, value, onChange, readOnly, focus }: {
  label: string; value: string; onChange: (value: string) => void; readOnly?: boolean; focus?: { line: number }
}) {
  const dark = useDark()
  const editor = useRef<ReactCodeMirrorRef>(null)
  // The editable area itself carries the name, for screen readers and tests.
  const extensions = useMemo(() => [...base, EditorView.contentAttributes.of({ "aria-label": label })], [label])
  useEffect(() => {
    const view = editor.current?.view
    if (!focus || !view) return
    const line = view.state.doc.line(Math.min(Math.max(focus.line, 1), view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) })
    view.focus()
  }, [focus])
  return <CodeMirror ref={editor} value={value} onChange={onChange} readOnly={readOnly} theme={dark ? "dark" : "light"} extensions={extensions}
    height="100%" className="h-full min-h-0 overflow-hidden rounded-lg border"
    basicSetup={{ foldGutter: false, highlightActiveLine: !readOnly, searchKeymap: true }} />
}
