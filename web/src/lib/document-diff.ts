export type TextChange = { kind: "same" | "added" | "removed"; text: string }
/** Compare extracted PDF lines, with bounded work for unusually large documents. */
export function documentDiff(before: string, after: string): TextChange[] {
  const lines = (text: string) => text.replaceAll("\r\n", "\n").split("\n").map(line => line.trim()).filter(Boolean)
  const a = lines(before), b = lines(after)
  if (a.length * b.length > 250_000) return [{ kind: "removed", text: before }, { kind: "added", text: after }]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
  const changes: TextChange[] = []
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { changes.push({ kind: "same", text: a[i++] }); j++ }
    else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) changes.push({ kind: "removed", text: a[i++] })
    else changes.push({ kind: "added", text: b[j++] })
  }
  return changes
}
