/**
 * Journey counts against real SQLite and the HTTP handlers: a workspace with
 * mixed origins and states yields the same totals in the Applications list,
 * the summary, the board and the dashboard; drafts are never counted as
 * submitted, and Jobs shows the latest linked application. Workspaces are
 * temporary; no ACP, MCP or portal is reached.
 */
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "work-tracker-counts-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let handle: (req: Request) => Promise<Response>;

const get = async (path: string) =>
  (await (await handle(new Request(`http://localhost/api/${path}?token=secret`))).json()) as any;
const board = async (action: string, body: unknown) => {
  const response = await handle(new Request(`http://localhost/api/application-board/${action}?token=secret`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }));
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as { id: number };
};
const job = (title: string) =>
  (db().query("INSERT INTO jobs (title, company_name, link) VALUES (?, 'Example Corp', ?) RETURNING id")
    .get(title, `https://jobs.example.test/${encodeURIComponent(title)}`) as { id: number }).id;
/** An application as Apply or an agent leaves it, before any board tracking. */
const untracked = (fields: Record<string, string | number>) => {
  const columns = Object.keys(fields);
  return (db().query(`INSERT INTO applications (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`)
    .get(...Object.values(fields)) as { id: number }).id;
};

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast: vi.fn() });
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("mixed origins and states produce coherent totals and never count drafts as submitted", async () => {
  const draftJob = job("Draft role");
  const retryJob = job("Retried role");
  job("Untouched role");
  const draft = untracked({ job_id: draftJob, origin: "preparation", status: "draft", preparation_status: "in_progress" });
  untracked({ job_id: job("Failed role"), origin: "preparation", status: "draft", preparation_status: "failed" });
  untracked({ origin: "agent", status: "draft" });
  const prepared = untracked({ job_id: job("Prepared role"), origin: "preparation", status: "draft", preparation_status: "ready" });
  untracked({ job_id: job("Filled role"), origin: "preparation", status: "filled", preparation_status: "ready", fill_status: "filled" });
  untracked({ job_id: job("Waiting role"), origin: "agent", status: "needs_input", preparation_status: "ready", fill_status: "needs_input" });
  untracked({ job_id: retryJob, origin: "preparation", attempt: 1, status: "draft" });
  const latest = untracked({ job_id: retryJob, origin: "preparation", attempt: 2, status: "draft", preparation_status: "ready" });
  untracked({ origin: "unknown", status: "submitted", submission_status: "submitted", applied_at: "2026-09-01T00:00:00.000Z", review_reason: "missing_stage" });
  const manual = { external_url: "https://careers.example.test/1", applied_at: "2026-09-10T12:00:00.000Z" };
  await board("create", { ...manual, company_name: "Manual One", request_id: "m1" });
  await board("create", { ...manual, company_name: "Manual Two", request_id: "m2" });
  const archived = await board("create", { ...manual, company_name: "Manual Three", request_id: "m3" });
  await board("archive", { id: archived.id, reason: "rejected" });

  const summary = await get("applications/summary");
  expect(summary).toEqual({
    total: 12,
    phases: { draft: 4, prepared: 2, filled: 2, submitted: 4 },
    views: { preparation: 9, tracking: 2, archived: 1 },
    origins: { preparation: 6, manual: 3, agent: 2, unknown: 1 },
    overlaps: { ready_resumes: 4, needs_input: 1, submitted_archived: 1, submitted_untracked: 1 },
  });
  expect((await get("overview")).journey).toEqual(summary);

  const list = (await get("applications")) as Array<{ id: number; phase: string; view: string; origin: string }>;
  const tally = (key: "phase" | "view") => Object.fromEntries(
    Object.keys(summary[key === "phase" ? "phases" : "views"]).map((name) => [name, list.filter((row) => row[key] === name).length]),
  );
  expect(list).toHaveLength(summary.total);
  expect(tally("phase")).toEqual(summary.phases);
  expect(tally("view")).toEqual(summary.views);
  expect(list.find((row) => row.id === draft)).toMatchObject({ phase: "draft", view: "preparation" });
  expect(list.filter((row) => row.origin === "manual").every((row) => row.phase === "submitted")).toBe(true);

  const tracked = (await get("application-board")).applications as Array<{ tracking_status: string }>;
  expect(tracked.filter((row) => row.tracking_status === "active")).toHaveLength(summary.views.tracking);
  expect(tracked.filter((row) => row.tracking_status === "archived")).toHaveLength(summary.views.archived);

  const jobs = (await get("jobs")) as Array<Record<string, unknown>>;
  expect(jobs).toHaveLength(7);
  expect(jobs.find((row) => row.id === draftJob)).toMatchObject({ application_id: draft, application_phase: "draft", application_view: "preparation", application_origin: "preparation" });
  expect(jobs.find((row) => row.id === retryJob)).toMatchObject({ application_id: latest, application_phase: "prepared" });
  expect(jobs.find((row) => row.title === "Prepared role")).toMatchObject({ application_id: prepared });
  expect(jobs.find((row) => row.title === "Untouched role")).toMatchObject({ application_id: null, application_phase: null, application_view: null });
});
