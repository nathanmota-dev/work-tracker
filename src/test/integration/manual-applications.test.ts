/**
 * Manual applications and legacy reconciliation against real SQLite and the
 * HTTP handlers: an application without a job links or creates its job and
 * opens preparation with that job's data; legacy records reconcile without new
 * IDs, duplicate jobs or cards; ambiguous matches and conflicts are never
 * associated automatically, and a rejected or failing change writes nothing.
 * Workspaces are temporary; no ACP, MCP or portal is reached.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "work-tracker-manual-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let backfillJourney: typeof import("../../db/journey-backfill.ts").backfillJourney;
let handle: (req: Request) => Promise<Response>;
let service: import("../../preparation/service.ts").PreparationService;
const broadcast = vi.fn();
const appliedAt = "2026-09-15T12:00:00.000Z";

const request = (path: string, body?: unknown) =>
  handle(new Request(`http://localhost${path}?token=secret`, body === undefined ? {} : {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
const board = async (action: string, body: unknown) => {
  const response = await request(`/api/application-board/${action}`, body);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};
const details = async (body: unknown) =>
  (await (await request("/api/application-preparation/details", body)).json()) as Record<string, any>;
const count = (sql: string, ...args: (string | number)[]) =>
  (db().query(`SELECT COUNT(*) AS n FROM ${sql}`).get(...args) as { n: number }).n;
const snapshot = () => ({
  applications: db().query("SELECT * FROM applications ORDER BY id").all(),
  jobs: db().query("SELECT * FROM jobs ORDER BY id").all(),
  events: count("application_events"),
  transitions: count("application_transitions"),
});
const job = (link: string, fields: Record<string, string> = {}) => {
  const values = { title: "Platform Engineer", company_name: "Example Corp", link, ...fields };
  return (db().query(`INSERT INTO jobs (${Object.keys(values).join(", ")}) VALUES (${Object.keys(values).map(() => "?").join(", ")}) RETURNING id`)
    .get(...Object.values(values)) as { id: number }).id;
};
/** Legacy rows as a pre-v4 workspace stored them, classified by the real v4 backfill. */
function legacyWorkspace(rows: Record<string, string | number | null>[]): number[] {
  const d = db();
  return d.transaction(() => {
    const ids = rows.map((fields) => {
      const columns = Object.keys(fields);
      return (d.query(`INSERT INTO applications (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`)
        .get(...Object.values(fields)) as { id: number }).id;
    });
    backfillJourney(d);
    return ids;
  })();
}

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  ({ backfillJourney } = await import("../../db/journey-backfill.ts"));
  const { PreparationService } = await import("../../preparation/service.ts");
  const { createRequestHandler } = await import("../../server/index.ts");
  const acp = { run: async () => {}, cancel: () => {} };
  service = new PreparationService(acp, broadcast);
  handle = createRequestHandler({ token: "secret", acp, broadcast, preparation: service });
});
beforeEach(() => {
  db().exec(`DROP TRIGGER IF EXISTS fail_link; DELETE FROM activity_log; DELETE FROM application_transitions; DELETE FROM application_events;
    UPDATE applications SET previous_application_id = NULL, preparation_run_id = NULL; DELETE FROM application_runs; DELETE FROM applications;
    DELETE FROM jobs;`);
  broadcast.mockClear();
});
afterAll(async () => {
  await service.close();
  closeDb();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("a manual application without job_id creates its job and opens preparation with the right data", async () => {
  const created = await board("create", {
    company_name: "Example Corp", external_url: "https://careers.example.test/jobs/42", role_title: "Platform Engineer",
    comp: "R$ 15k", applied_at: appliedAt, request_id: "manual-1",
  });
  expect(created.status).toBe(201);
  const id = created.body.id as number;
  expect(created.body.job_id).toBeNull();
  const options = await board("link/options", { id });
  expect(options.body).toMatchObject({ application_id: id, candidates: [], missing: ["description"] });

  const linked = await board("link", { id, create: true, description: "Own the platform." });
  expect(linked.body).toEqual({ application_id: id, job_id: expect.any(Number), created_job: true, missing: [] });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "jobs" });
  const prepared = await details({ jobId: linked.body.job_id, applicationId: id });
  expect(prepared.job).toMatchObject({ id: linked.body.job_id, title: "Platform Engineer", company_name: "Example Corp",
    link: "https://careers.example.test/jobs/42", description: "Own the platform." });
  expect(prepared.journey).toMatchObject({ id, origin: "manual", submission_status: "submitted", submitted_at: appliedAt });
  expect(db().query("SELECT comp FROM jobs").get()).toEqual({ comp: "R$ 15k" });
  // The card keeps its identity, stage and single event.
  expect(count("applications")).toBe(1);
  expect(count("application_events WHERE application_id = ?", id)).toBe(1);
  expect((await board("link", { id, create: true })).status).toBe(409);
  expect(count("jobs")).toBe(1);
});

test("a manual application links an existing job and preparation reuses that job", async () => {
  const saved = job("https://www.linkedin.com/jobs/view/987654", { linkedin_job_id: "987654" });
  const { body } = await board("create", { company_name: "Example Corp", external_url: "https://linkedin.com/jobs/view/platform-987654/", applied_at: appliedAt });
  const options = await board("link/options", { id: body.id });
  expect(options.body.candidates).toEqual([expect.objectContaining({ id: saved, match: "linkedin_id", application_id: null })]);
  expect((await board("link", { id: body.id, job_id: saved })).body).toMatchObject({ job_id: saved, created_job: false, missing: [] });
  const prepared = await details({ jobId: saved, applicationId: body.id });
  expect(prepared.journey.id).toBe(body.id);
  expect(db().query("SELECT role_title, attempt FROM applications WHERE id = ?").get(body.id)).toEqual({ role_title: "Platform Engineer", attempt: 1 });
  // Registering the same job again from the board reuses this application.
  expect((await board("create", { company_name: "Example Corp", external_url: "https://x.test", job_id: saved })).body.id).toBe(body.id);
  expect(count("applications")).toBe(1);
});

test("repeated reconciliation adds no job or card, and ambiguity is never associated automatically", async () => {
  const first = job("https://careers.example.test/shared");
  const second = job("https://careers.example.test/shared/");
  db().query("INSERT INTO application_runs (id, job_id, status, phase, provider, created_at, updated_at) VALUES ('legacy-run', ?, 'completed', 'review', 'fake', ?, ?)")
    .run(first, appliedAt, appliedAt);
  const [onBoardMissing, appliedOutside, ambiguous, preparedApplied] = legacyWorkspace([
    { status: "submitted", applied_at: appliedAt, company_name: "Sent Corp", external_url: "https://sent.test/job" },
    { status: "applied", applied_at: appliedAt, company_name: "Agent Corp", external_url: "https://agent.test/job" },
    { status: "draft", company_name: "Shared Corp", external_url: "https://careers.example.test/shared" },
    { status: "applied", applied_at: appliedAt, company_name: "Apply Corp", external_url: "https://apply.test/job", preparation_run_id: "legacy-run", resume_path: "/fixture/resume.pdf" },
  ]);
  const before = snapshot();
  const review = await board("review", {});
  expect(review.body.items.map((item: { id: number }) => item.id)).toEqual([onBoardMissing, appliedOutside, ambiguous, preparedApplied]);
  expect(review.body.items.find((item: { id: number }) => item.id === ambiguous).candidates.map((c: { id: number }) => c.id)).toEqual([first, second]);

  const reconciled = await board("review/reconcile", {});
  expect(reconciled.body.fixed).toEqual([onBoardMissing, appliedOutside]);
  const after = snapshot();
  expect(after.applications.map((row: any) => row.id)).toEqual(before.applications.map((row: any) => row.id));
  expect(after.jobs).toEqual(before.jobs);
  expect(after.events).toBe(2);
  for (const id of [onBoardMissing, appliedOutside])
    expect(db().query("SELECT submission_status, tracking_status, review_reason, applied_at FROM applications WHERE id = ?").get(id))
      .toEqual({ submission_status: "submitted", tracking_status: "active", review_reason: null, applied_at: appliedAt });
  expect(db().query("SELECT job_id, review_reason FROM applications WHERE id = ?").get(ambiguous)).toEqual({ job_id: null, review_reason: "missing_job" });
  expect(db().query("SELECT submission_status, review_reason FROM applications WHERE id = ?").get(preparedApplied))
    .toEqual({ submission_status: "not_submitted", review_reason: "unknown_status" });

  const repeated = await board("review/reconcile", {});
  expect(repeated).toEqual({ status: 200, body: { fixed: [], items: reconciled.body.items } });
  expect(snapshot()).toEqual(after);
  // The reviewer resolves the ambiguity explicitly.
  expect((await board("link", { id: ambiguous, job_id: second })).body).toMatchObject({ job_id: second });
  expect(db().query("SELECT job_id, review_reason FROM applications WHERE id = ?").get(ambiguous)).toEqual({ job_id: second, review_reason: null });
});

test("conflicts and failures leave no partial change", async () => {
  const taken = job("https://careers.example.test/taken");
  const [owner, duplicate] = legacyWorkspace([
    { status: "submitted", job_id: taken, applied_at: appliedAt, current_stage_id: 1, tracking_status: "active", company_name: "A", external_url: "https://a.test" },
    { status: "draft", job_id: taken },
  ]);
  const { body } = await board("create", { company_name: "Example Corp", external_url: "https://careers.example.test/taken", applied_at: appliedAt });
  const state = snapshot();
  const conflict = await board("link", { id: body.id, job_id: taken });
  expect(conflict).toEqual({ status: 409, body: { error: `Job #${taken} already has application #${owner}. Review both records instead of linking another one.` } });
  expect((await board("link", { id: body.id, create: true, role_title: "Role" })).body).toEqual({ error: `Job #${taken} already has this link. Link that job instead of creating another one.` });
  expect((await board("review/resolve", { id: duplicate, decision: "mark_submitted" })).status).toBe(409);
  db().exec("CREATE TRIGGER fail_link BEFORE INSERT ON activity_log BEGIN SELECT RAISE(ABORT, 'log unavailable'); END");
  // The HTTP adapter answers 500 for this unexpected error.
  await expect(request("/api/application-board/link", { id: body.id, create: true, external_url: "https://careers.example.test/new", role_title: "Role" }))
    .rejects.toThrow("log unavailable");
  expect(snapshot()).toEqual(state);
  db().exec("DROP TRIGGER fail_link");
  expect((await board("review/resolve", { id: duplicate, decision: "keep_attempt" })).body).toEqual({ item: null });
  expect(db().query("SELECT previous_application_id FROM applications WHERE id = ?").get(duplicate)).toEqual({ previous_application_id: owner });
});
