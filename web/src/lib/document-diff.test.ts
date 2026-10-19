import { expect, it } from "vitest"
import { documentDiff } from "./document-diff"
it("keeps shared PDF lines and marks additions and removals", () => {
  expect(documentDiff("Name\r\nOld project\nReact", "Name\nNew project\nReact")).toEqual([
    { kind: "same", text: "Name" }, { kind: "removed", text: "Old project" }, { kind: "added", text: "New project" }, { kind: "same", text: "React" },
  ])
  expect(documentDiff("", "Added")).toEqual([{ kind: "added", text: "Added" }])
  expect(documentDiff("Removed", "")).toEqual([{ kind: "removed", text: "Removed" }])
  expect(documentDiff("", "")).toEqual([])
})
it("bounds work for long documents", () => {
  expect(documentDiff("old\n".repeat(501), "new\n".repeat(501))).toHaveLength(2)
})
