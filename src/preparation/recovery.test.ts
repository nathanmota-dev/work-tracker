import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import { addCheckpoint, deriveRecovery, dropCheckpoints, markPortal, parseRecovery, type StoredRecovery } from "./recovery.ts";
import type { PdfArtifact, PreparationRun } from "./types.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
const base: PdfArtifact = { id: "b", kind: "base", pages: 1, warnings: [] };
const tailored: PdfArtifact = { id: "t", kind: "tailored", pages: 1, warnings: [] };
const run = (status: PreparationRun["status"], phase: PreparationRun["phase"], artifacts: PdfArtifact[] = []) => ({ status, phase, artifacts });
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
});
test.each([
  ["", {}],
  ["[1]", {}],
  ["{", {}],
  ['{"portal":"started"}', { portal: "started" }],
])("parses stored recovery %j defensively", (json, expected) => {
  expect(parseRecovery(json)).toEqual(expected);
});
test("running and completed runs have nothing to retry but expose their checkpoints", () => {
  expect(deriveRecovery(run("running", "tailoring", [base]), { checkpoints: ["tailored"] })).toEqual({ checkpoints: ["sources", "tailored"], retryFrom: null, reviewRequired: false, summary: null });
  expect(deriveRecovery(run("completed", "review", [base, tailored]), {}).retryFrom).toBeNull();
});
test.each([
  ["failed", "preparing", [], {}, "preparing", "Source preparation failed. Retrying starts this execution again."],
  ["interrupted", "tailoring", [base], {}, "tailoring", "The app closed during tailoring. Retrying continues from tailoring with the saved source snapshot."],
  ["cancelled", "compiling", [base], { checkpoints: ["tailored"] }, "compiling", "Compilation was cancelled. Retrying continues from compilation with the tailored sources."],
  ["failed", "compiling", [base], {}, "tailoring", "Compilation failed. Retrying continues from tailoring with the saved source snapshot."],
  ["waiting_for_sign_in", "tailoring", [base], {}, "tailoring", "Tailoring is waiting for sign-in. Complete it in the browser first. Retrying continues from tailoring with the saved source snapshot."],
  ["failed", "filling", [base, tailored], {}, "filling", "Portal filling failed. Retrying continues from portal filling with the validated resume; it is not regenerated."],
  ["failed", "review", [base], {}, null, null],
  ["failed", "filling", [], {}, null, null],
] as const)("a %s run stopped in %s retries from the phase it needs", (status, phase, artifacts, stored, retryFrom, summary) => {
  const recovery = deriveRecovery(run(status, phase, [...artifacts]), stored as StoredRecovery);
  expect(recovery).toMatchObject({ retryFrom, summary, reviewRequired: false });
});
test("an unknown stored phase still yields a safe retry and summary", () => {
  expect(deriveRecovery(run("interrupted", "unknown" as PreparationRun["phase"]), {})).toMatchObject({ retryFrom: "preparing", summary: "The app closed during this execution. Retrying starts this execution again." });
});
test("a portal fill that stopped without a result requires review instead of an automatic retry", () => {
  const recovery = deriveRecovery(run("interrupted", "filling", [base, tailored]), { portal: "started" });
  expect(recovery).toMatchObject({ retryFrom: "filling", reviewRequired: true, checkpoints: ["sources", "compiled"] });
  expect(recovery.summary).toContain("The app closed during portal filling.");
  expect(recovery.summary).toContain("Review it in the browser");
  expect(deriveRecovery(run("waiting_for_sign_in", "filling", [tailored]), {}).reviewRequired).toBe(false);
});
test("checkpoint and portal changes rewrite the persisted state and skip missing runs", () => {
  d.statement.get.mockReturnValue({ recovery_json: '{"checkpoints":["sources"],"portal":"started"}' });
  addCheckpoint("r", "tailored");
  expect(d.statement.run).toHaveBeenLastCalledWith('{"checkpoints":["sources","tailored"],"portal":"started"}', "r");
  addCheckpoint("r", "sources");
  expect(d.statement.run).toHaveBeenLastCalledWith('{"checkpoints":["sources"],"portal":"started"}', "r");
  dropCheckpoints("r", "sources");
  expect(d.statement.run).toHaveBeenLastCalledWith('{"checkpoints":[],"portal":"started"}', "r");
  markPortal("r", false);
  expect(d.statement.run).toHaveBeenLastCalledWith('{"checkpoints":["sources"],"portal":null}', "r");
  d.statement.get.mockReturnValue({ recovery_json: "{}" });
  markPortal("r", true);
  expect(d.statement.run).toHaveBeenLastCalledWith('{"portal":"started"}', "r");
  dropCheckpoints("r", "tailored");
  expect(d.statement.run).toHaveBeenLastCalledWith('{"checkpoints":[]}', "r");
  d.statement.run.mockClear();
  d.statement.get.mockReturnValue(undefined);
  markPortal("missing", true);
  expect(d.statement.run).not.toHaveBeenCalled();
});
