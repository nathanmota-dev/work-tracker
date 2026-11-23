/**
 * Quiet-application sweep against real SQLite, the HTTP handlers and the
 * compiled CLI: the scan lists only old submitted applications, closing them is
 * a batch that repeats safely, and activity between the listing and the
 * confirmation keeps an application open. The workspace is temporary.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { QuietApplications, QuietResolution, TrackedApplication } from "../../applications/types.ts";

const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "work-tracker-quiet-"));
const previousEnv = { ...process.env };
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_CLI = resolve("out/cli/work-tracker.cjs");
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let handle: (req: Request) => Promise<Response>;
const broadcast = vi.fn();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [process.env.WORK_TRACKER_CLI!, ...args], { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
const api = (path: string, body?: unknown) =>
  handle(new Request(`http://localhost/api/${path}${path.includes("?") ? "&" : "?"}token=secret`, body === undefined ? {} : {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
const json = async <T>(path: string, body?: unknown) => (await (await api(path, body)).json()) as T;
/** Register an application through the board, then move all of its history `days` back. */
async function sentDaysAgo(company_name: string, days: number): Promise<number> {
  const { id } = await json<TrackedApplication>("application-board/create", {
    company_name, external_url: `https://jobs.example.test/${company_name}`, applied_at: ago(days),
  });
  db().query("UPDATE application_events SET occurred_at = ? WHERE application_id = ?").run(ago(days), id);
  db().query("UPDATE application_transitions SET occurred_at = ? WHERE application_id = ?").run(ago(days), id);
  return id;
}
const archivedEvents = () =>
  db().query("SELECT application_id, reason, note FROM application_events WHERE event_type = 'archived' ORDER BY id").all();

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast });
  db();
});
beforeEach(() => {
  db().exec("DELETE FROM application_events; DELETE FROM application_transitions; DELETE FROM applications;");
  broadcast.mockClear();
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});

test("scans through the API, the CLI and the dashboard with the same rules", async () => {
  const old = await sentDaysAgo("Old", 75);
  const older = await sentDaysAgo("Older", 120);
  await sentDaysAgo("Recent", 20);
  const offer = await sentDaysAgo("Offer", 90);
  const offerStage = db().query("SELECT id FROM application_stages WHERE key = 'offer'").get() as { id: number };
  db().query("UPDATE applications SET current_stage_id = ? WHERE id = ?").run(offerStage.id, offer);
  db().query("INSERT INTO applications (status, attempt, company_name, applied_at) VALUES ('draft', 1, 'Draft', ?)").run(ago(200));
  broadcast.mockClear();
  const scan = await json<QuietApplications>("application-board/quiet");
  expect(scan).toMatchObject({ days: 60, skipped: [], items: [
    { id: older, company_name: "Older", stage_name: "Applied", days_quiet: 120 },
    { id: old, company_name: "Old", days_quiet: 75 },
  ] });
  expect((await json<QuietApplications>("application-board/quiet?days=100")).items.map((item) => item.id)).toEqual([older]);
  const invalid = await api("application-board/quiet?days=6");
  expect(invalid.status).toBe(400);
  expect((await api("application-board/quiet", {})).status).toBe(405);
  expect(await json("overview")).toMatchObject({ quiet: 2 });
  const fromCli = await cli("application", "quiet", "--days", "100");
  expect(fromCli.code).toBe(0);
  expect(JSON.parse(fromCli.stdout)).toMatchObject({ days: 100, items: [{ id: older, days_quiet: 120 }], skipped: [] });
  expect(await cli("application", "quiet", "--days", "3")).toMatchObject({ code: 1, stderr: expect.stringContaining("from 7 to 3650") });
  // Scanning only reads.
  expect(broadcast).not.toHaveBeenCalled();
});

test("closes a batch once, keeps applications with late activity open and reopens as before", async () => {
  const first = await sentDaysAgo("First", 80);
  const second = await sentDaysAgo("Second", 70);
  const moved = await sentDaysAgo("Moved", 65);
  const listed = await json<QuietApplications>("application-board/quiet");
  expect(listed.items.map((item) => item.id)).toEqual([first, second, moved]);
  // The user moves one card on the board after the listing and before confirming.
  const technical = db().query("SELECT id FROM application_stages WHERE key = 'technical'").get() as { id: number };
  await api("application-board/move", { id: moved, stage_id: technical.id });
  broadcast.mockClear();
  const ids = listed.items.map((item) => item.id);
  expect(await json<QuietResolution>("application-board/quiet/resolve", { ids })).toEqual({
    resolved: [first, second],
    skipped: [{ id: moved, reason: "No longer quiet" }],
  });
  expect(broadcast.mock.calls).toEqual([[{ type: "changed", table: "applications" }], [{ type: "changed", table: "application_events" }]]);
  expect(archivedEvents()).toEqual([
    { application_id: first, reason: "no_response", note: "Closed by quiet sweep (80 days without activity)" },
    { application_id: second, reason: "no_response", note: "Closed by quiet sweep (70 days without activity)" },
  ]);
  expect(await json("overview")).toMatchObject({ quiet: 0, journey: { views: { archived: 2, tracking: 1 } } });
  // Repeating the confirmation records nothing new and broadcasts nothing.
  broadcast.mockClear();
  expect(await json<QuietResolution>("application-board/quiet/resolve", { ids })).toEqual({
    resolved: [],
    skipped: [{ id: first, reason: "Already archived" }, { id: second, reason: "Already archived" }, { id: moved, reason: "No longer quiet" }],
  });
  expect(archivedEvents()).toHaveLength(2);
  expect(broadcast).not.toHaveBeenCalled();
  expect((await api("application-board/quiet/resolve", { ids: [] })).status).toBe(400);
  // Reopening from the board returns the application to its previous stage.
  const reopened = await json<TrackedApplication>("application-board/reopen", { id: first });
  expect(reopened).toMatchObject({ tracking_status: "active", archive_reason: null });
  const applied = db().query("SELECT id FROM application_stages WHERE key = 'applied'").get() as { id: number };
  expect(reopened.current_stage_id).toBe(applied.id);
  // The reopen event is activity, so the application is no longer quiet.
  expect((await json<QuietApplications>("application-board/quiet")).items).toEqual([]);
});
