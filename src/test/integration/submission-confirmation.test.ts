/**
 * "I submitted in the browser" against real SQLite and the HTTP handlers: the
 * confirmation records the submission, puts the same application on the board
 * with one event, repeats (sequential or concurrent) change nothing, and an
 * incompatible execution or a failing write leaves no partial change.
 * Workspaces are temporary; no ACP, MCP or portal is reached.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "work-tracker-submission-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let store: typeof import("../../applications/journey-store.ts");
let handle: (req: Request) => Promise<Response>;
let service: import("../../preparation/service.ts").PreparationService;
const broadcast = vi.fn();
const at = "2026-10-17T10:00:00.000Z";

const request = (path: string, body?: unknown) =>
  handle(new Request(`http://localhost${path}?token=secret`, body === undefined ? {} : {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
const confirm = (body: unknown) => request("/api/application-preparation/submitted", body);
const count = (sql: string, ...args: (string | number)[]) =>
  (db().query(`SELECT COUNT(*) AS n FROM ${sql}`).get(...args) as { n: number }).n;
const row = (id: number) =>
  db().query(`SELECT id, submission_status, submitted_at, applied_at, current_stage_id, tracking_status, company_name,
    role_title, external_url, status FROM applications WHERE id = ?`).get(id) as Record<string, unknown>;
const initialStage = () => (db().query("SELECT id FROM application_stages WHERE key = 'applied'").get() as { id: number }).id;
/** Everything a confirmation may write, to prove a rejected one wrote nothing. */
const snapshot = () => ({
  applications: db().query("SELECT * FROM applications ORDER BY id").all(),
  events: count("application_events"),
  transitions: count("application_transitions"),
});

/** A job prepared and filled by `runId`, waiting for the candidate's confirmation. */
function filledApplication(jobId: number, runId: string): number {
  const d = db();
  d.query("INSERT INTO jobs (id, title, company_name, link) VALUES (?, 'Engineer', 'Example Corp', 'https://jobs.example.test/role')").run(jobId);
  d.query("INSERT INTO application_runs (id, job_id, status, phase, provider, created_at, updated_at) VALUES (?, ?, 'completed', 'review', 'fake', ?, ?)").run(runId, jobId, at, at);
  d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES (?, ?, 'tailored', '/fixture/resume.pdf', 1, '', '[]')").run(`pdf-${runId}`, runId);
  return d.transaction(() => {
    const { record } = store.openApplication(d, { jobId, origin: "preparation" });
    d.query("UPDATE applications SET preparation_run_id = ?, resume_path = '/fixture/resume.pdf', fields_filled_json = '{}' WHERE id = ?").run(runId, record.id);
    d.query("UPDATE application_runs SET application_id = ? WHERE id = ?").run(record.id, runId);
    store.transition(d, record.id, "prepare.complete", "agent", { runId });
    store.transition(d, record.id, "fill.complete", "agent", { runId });
    return record.id;
  })();
}

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  store = await import("../../applications/journey-store.ts");
  const { PreparationService } = await import("../../preparation/service.ts");
  const { createRequestHandler } = await import("../../server/index.ts");
  const acp = { run: async () => {}, cancel: () => {} };
  service = new PreparationService(acp, broadcast);
  handle = createRequestHandler({ token: "secret", acp, broadcast, preparation: service });
});
beforeEach(() => {
  db().exec(`DROP TRIGGER IF EXISTS fail_board_event; DELETE FROM application_transitions; DELETE FROM application_events;
    DELETE FROM pdf_artifacts; UPDATE applications SET preparation_run_id = NULL, previous_application_id = NULL;
    DELETE FROM application_runs; DELETE FROM applications; DELETE FROM jobs;`);
  broadcast.mockClear();
});
afterAll(async () => {
  await service.close();
  closeDb();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("filled → submitted records one event and makes the same record visible on the board", async () => {
  const id = filledApplication(1, "run-1");
  const board = async () => (await (await request("/api/application-board")).json()) as { applications: { id: number }[] };
  expect((await board()).applications).toEqual([]);

  const response = await confirm({ runId: "run-1", applicationId: id });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { submittedAt: string };
  expect(body).toEqual({ ok: true, alreadySubmitted: false, applicationId: id, submittedAt: expect.any(String) });

  expect(row(id)).toMatchObject({
    submission_status: "submitted", submitted_at: body.submittedAt, applied_at: body.submittedAt, status: "submitted",
    current_stage_id: initialStage(), tracking_status: "active",
    company_name: "Example Corp", role_title: "Engineer", external_url: "https://jobs.example.test/role",
  });
  expect(db().query("SELECT event_type, to_stage_id FROM application_events WHERE application_id = ?").all(id))
    .toEqual([{ event_type: "created", to_stage_id: initialStage() }]);
  expect(count("application_transitions WHERE application_id = ? AND action = 'submit'", id)).toBe(1);
  expect((await board()).applications).toEqual([expect.objectContaining({ id, current_stage_id: initialStage(), submitted_at: body.submittedAt })]);
  expect(count("applications")).toBe(1);
  // The board and Applications screens refresh from these events, without restarting the app.
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "applications" });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "application_events" });
});

test("repeated and concurrent confirmations keep the ID, the date and a single event", async () => {
  const id = filledApplication(1, "run-1");
  const first = (await (await confirm({ runId: "run-1" })).json()) as { submittedAt: string };
  const state = snapshot();
  broadcast.mockClear();
  const repeats = await Promise.all([confirm({ runId: "run-1" }), confirm({ runId: "run-1", applicationId: id }), confirm({ runId: "run-1" })]);
  for (const response of repeats) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadySubmitted: true, applicationId: id, submittedAt: first.submittedAt });
  }
  expect(snapshot()).toEqual(state);
  expect(count("application_events WHERE application_id = ?", id)).toBe(1);
  expect(broadcast).not.toHaveBeenCalled();
});

test("concurrent first confirmations create exactly one submission and one board card", async () => {
  const id = filledApplication(1, "run-1");
  const results = await Promise.all([confirm({ runId: "run-1" }), confirm({ runId: "run-1" })]);
  const bodies = (await Promise.all(results.map((response) => response.json()))) as { alreadySubmitted: boolean; applicationId: number }[];
  expect(bodies.map((body) => body.alreadySubmitted).sort()).toEqual([false, true]);
  expect(bodies.every((body) => body.applicationId === id)).toBe(true);
  expect(count("applications")).toBe(1);
  expect(count("application_events")).toBe(1);
  expect(count("application_transitions WHERE action = 'submit'")).toBe(1);
});

test("an incompatible execution is rejected without any write", async () => {
  const id = filledApplication(1, "run-1");
  const other = filledApplication(2, "run-2");
  // An older execution of the same job whose PDF is no longer the filled document.
  db().query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at) VALUES ('run-old', 1, ?, 'completed', 'review', 'fake', ?, ?)").run(id, at, at);
  db().query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('pdf-old', 'run-old', 'tailored', '/fixture/old.pdf', 1, '', '[]')").run();
  // An execution that claims an application of another job.
  db().query("INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at) VALUES ('run-cross', 1, ?, 'completed', 'review', 'fake', ?, ?)").run(other, at, at);
  db().query("UPDATE applications SET preparation_run_id = 'run-cross' WHERE id = ?").run(other);
  db().query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('pdf-cross', 'run-cross', 'tailored', '/fixture/cross.pdf', 1, '', '[]')").run();
  const state = snapshot();

  const cases: [unknown, number, string][] = [
    [{ runId: "run-1", applicationId: other }, 409, "belongs to another application"],
    [{ runId: "run-cross" }, 409, "belongs to another application"],
    [{ runId: "run-old" }, 400, "Fill and submit"],
    [{ runId: "missing" }, 404, "not found"],
  ];
  for (const [body, status, message] of cases) {
    const response = await confirm(body);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: expect.stringContaining(message) });
  }
  expect(snapshot()).toEqual(state);
  expect(row(id)).toMatchObject({ submission_status: "not_submitted", current_stage_id: null });
  expect(broadcast).not.toHaveBeenCalled();
});

test("a failing board write rolls back the submission and a retry succeeds", async () => {
  const id = filledApplication(1, "run-1");
  const state = snapshot();
  db().exec("CREATE TRIGGER fail_board_event BEFORE INSERT ON application_events BEGIN SELECT RAISE(ABORT, 'board unavailable'); END");
  const failed = await confirm({ runId: "run-1" });
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: expect.stringContaining("board unavailable") });
  expect(snapshot()).toEqual(state);
  expect(broadcast).not.toHaveBeenCalled();

  db().exec("DROP TRIGGER fail_board_event");
  const retried = await confirm({ runId: "run-1" });
  expect(await retried.json()).toMatchObject({ alreadySubmitted: false, applicationId: id });
  expect(row(id)).toMatchObject({ submission_status: "submitted", tracking_status: "active" });
});

test("a submitted application missing from the board enters it once, keeping its original date", async () => {
  const id = filledApplication(1, "run-1");
  db().transaction(() => store.transition(db(), id, "submit", "cli", { at: "2026-10-01T09:00:00.000Z" }))();
  const response = await confirm({ runId: "run-1" });
  expect(await response.json()).toEqual({ ok: true, alreadySubmitted: true, applicationId: id, submittedAt: "2026-10-01T09:00:00.000Z" });
  expect(row(id)).toMatchObject({ submitted_at: "2026-10-01T09:00:00.000Z", applied_at: "2026-10-01T09:00:00.000Z", tracking_status: "active" });
  expect(count("application_events WHERE application_id = ?", id)).toBe(1);
  expect(count("application_transitions WHERE application_id = ? AND action = 'submit'", id)).toBe(1);
});
