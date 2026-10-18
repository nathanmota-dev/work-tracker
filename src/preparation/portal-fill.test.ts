import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { databaseDouble } from "../test/doubles.ts";
import { journeyRecord, settleExecution, transition, type JourneyRecord } from "../applications/journey-store.ts";
import { addCheckpoint, markPortal } from "./recovery.ts";
import { updateRun } from "./store.ts";
import { CLOSED_MESSAGE, SIGN_IN_LOST_MESSAGE, applyFillResult, fillManifestPath, interruptStaleRuns, readFillResult, webLink, type FillManifest } from "./portal-fill.ts";
vi.mock("../db/index.ts", () => ({ now: () => "now" }));
vi.mock("../applications/journey-store.ts", () => ({ journeyRecord: vi.fn(), settleExecution: vi.fn(), transition: vi.fn() }));
vi.mock("./recovery.ts", async (original) => ({ ...(await original<typeof import("./recovery.ts")>()), addCheckpoint: vi.fn(), markPortal: vi.fn() }));
vi.mock("./store.ts", () => ({ updateRun: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
let files: Record<string, string>;
const manifest: FillManifest = { runId: "r", applicationId: 2, pdfPath: "/artifacts/r/resume.pdf", url: "https://portal.invalid/", resultPath: "/artifacts/r/fill-result.json", reportPath: "/artifacts/r/report.md", coverPath: "/artifacts/r/cover.md" };
const stale = (fields: Record<string, unknown> = {}) => ({ id: "r", application_id: 2, status: "running", phase: "filling", manifest_json: '{"manifestPath":"/artifacts/r/manifest.json"}', recovery_json: '{"portal":"started"}', ...fields });
beforeEach(() => {
  d = databaseDouble();
  files = { "/artifacts/r/fill-manifest.json": JSON.stringify(manifest), "/artifacts/r/fill-result.json": '{"fields":{"name":"Ana"},"unfilled":[],"portal":"lever"}' };
  vi.mocked(fs.readFileSync).mockImplementation(path => {
    if (!(String(path) in files)) throw new Error("ENOENT");
    return files[String(path)]!;
  });
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(journeyRecord).mockReset().mockReturnValue({ submission_status: "not_submitted" } as JourneyRecord);
  vi.mocked(settleExecution).mockReset();
  vi.mocked(transition).mockReset();
  vi.mocked(updateRun).mockReset();
});
test("accepts only HTTP portal links", () => {
  expect(webLink("https://portal.invalid")).toBe("https://portal.invalid/");
  expect(() => webLink("file:///secret")).toThrow("HTTP or HTTPS");
  expect(() => webLink("not a url")).toThrow("HTTP or HTTPS");
  expect(fillManifestPath("/artifacts/r/manifest.json")).toBe("/artifacts/r/fill-manifest.json");
});
test("reads a valid fill result and defaults its portal and URL", () => {
  expect(readFillResult(manifest)).toEqual({ fields: { name: "Ana" }, unfilled: [], externalUrl: "https://portal.invalid/", portal: "lever" });
  files[manifest.resultPath] = '{"fields":{},"unfilled":[],"externalUrl":"https://final.invalid/x"}';
  expect(readFillResult(manifest)).toMatchObject({ externalUrl: "https://final.invalid/x", portal: "generic" });
  for (const invalid of ['{"fields":[],"unfilled":[]}', '{"fields":{},"unfilled":null}', '{"unfilled":[]}']) {
    files[manifest.resultPath] = invalid;
    expect(() => readFillResult(manifest)).toThrow("valid fill result");
  }
});
test("applying a fill result stores it, completes the run and clears the portal marker", () => {
  applyFillResult(d.asDatabase, manifest, readFillResult(manifest));
  expect(d.statement.run).toHaveBeenCalledWith('{"name":"Ana"}', "[]", "https://portal.invalid/", "lever", manifest.pdfPath, "r", manifest.reportPath, manifest.coverPath, 2);
  expect(transition).toHaveBeenCalledWith(d.asDatabase, 2, "fill.complete", "agent", { runId: "r" });
  expect(addCheckpoint).toHaveBeenCalledWith("r", "filled");
  expect(markPortal).toHaveBeenCalledWith("r", false);
  expect(updateRun).toHaveBeenCalledWith("r", { status: "completed", phase: "review", error: null });
  vi.mocked(fs.existsSync).mockReturnValue(false);
  applyFillResult(d.asDatabase, { ...manifest, coverPath: null }, readFillResult(manifest));
  expect(d.statement.run).toHaveBeenLastCalledWith(expect.anything(), "[]", expect.anything(), "lever", manifest.pdfPath, "r", manifest.reportPath, null, 2);
});
test("startup completes an interrupted fill from the result its agent saved", () => {
  d.statement.all.mockReturnValue([stale()]);
  interruptStaleRuns(d.asDatabase);
  expect(transition).toHaveBeenCalledWith(d.asDatabase, 2, "fill.complete", "agent", { runId: "r" });
  expect(settleExecution).not.toHaveBeenCalled();
  expect(updateRun).toHaveBeenCalledWith("r", { status: "completed", phase: "review", error: null });
});
test.each([
  ["no saved result", () => { delete files[manifest.resultPath]; }],
  ["a manifest for another run", () => { files["/artifacts/r/fill-manifest.json"] = JSON.stringify({ ...manifest, runId: "other" }); }],
  ["a submitted application", () => { vi.mocked(journeyRecord).mockReturnValue({ submission_status: "submitted" } as JourneyRecord); }],
])("startup leaves an interrupted fill with %s for review", (_name, arrange) => {
  arrange();
  d.statement.all.mockReturnValue([stale()]);
  interruptStaleRuns(d.asDatabase);
  expect(transition).not.toHaveBeenCalled();
  expect(d.statement.run).toHaveBeenCalledWith(CLOSED_MESSAGE, "now", "r");
  expect(settleExecution).toHaveBeenCalledWith(d.asDatabase, 2, "fill", "failed", "r");
});
test("startup never promises to restore a lost sign-in session and settles generation runs", () => {
  d.statement.all.mockReturnValue([
    stale({ id: "sign", status: "waiting_for_sign_in", phase: "tailoring", recovery_json: "{}" }),
    stale({ id: "orphan", application_id: null, phase: "preparing" }),
  ]);
  interruptStaleRuns(d.asDatabase);
  expect(d.statement.run).toHaveBeenCalledWith(SIGN_IN_LOST_MESSAGE, "now", "sign");
  expect(d.statement.run).toHaveBeenCalledWith(CLOSED_MESSAGE, "now", "orphan");
  expect(settleExecution).toHaveBeenCalledTimes(1);
  expect(settleExecution).toHaveBeenCalledWith(d.asDatabase, 2, "preparation", "failed", "sign");
  expect(SIGN_IN_LOST_MESSAGE).toContain("cannot be restored");
});
