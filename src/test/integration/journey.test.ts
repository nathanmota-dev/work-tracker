/**
 * Application journey invariants against real SQLite, the HTTP handlers and the
 * compiled CLI: the same operation through API and CLI produces the same state,
 * repeating it adds no record or transition, and the v4 migration keeps history
 * while allowing a new attempt only by the explicit republication rule.
 * Workspaces are temporary; no ACP, MCP or portal is reached.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Database } from "../../db/sqlite.ts";

const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "work-tracker-journey-"));
const previousEnv = { ...process.env };
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_CLI = resolve("out/cli/work-tracker.cjs");
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let store: typeof import("../../applications/journey-store.ts");
let migrateDatabase: typeof import("../../db/migrations.ts").migrateDatabase;
let handle: (req: Request) => Promise<Response>;
let service: import("../../preparation/service.ts").PreparationService;
const broadcast = vi.fn();

/** Runs the compiled CLI; resolves with its exit code instead of throwing. */
async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [process.env.WORK_TRACKER_CLI!, ...args], { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
const post = (path: string, body: unknown) =>
  handle(new Request(`http://localhost${path}?token=secret`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
const count = (sql: string, ...args: (string | number)[]) =>
  (db().query(`SELECT COUNT(*) AS n FROM ${sql}`).get(...args) as { n: number }).n;
const journey = (id: number) =>
  db().query("SELECT id, job_id, origin, attempt, previous_application_id, preparation_status, fill_status, submission_status, submitted_at, status FROM applications WHERE id = ?").get(id) as Record<string, unknown>;
const transitions = (id: number) =>
  (db().query("SELECT action, actor FROM application_transitions WHERE application_id = ? ORDER BY id").all(id) as { action: string; actor: string }[]);
const saveJob = (id: number, linkedin: string | null) =>
  db().query("INSERT INTO jobs (id, linkedin_job_id, title, company_name, link) VALUES (?, ?, 'Engineer', 'Example Corp', 'https://jobs.example.test/role')").run(id, linkedin);

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  store = await import("../../applications/journey-store.ts");
  ({ migrateDatabase } = await import("../../db/migrations.ts"));
  const { PreparationService } = await import("../../preparation/service.ts");
  const { createRequestHandler } = await import("../../server/index.ts");
  const acp = { run: async () => {}, cancel: () => {} };
  service = new PreparationService(acp, broadcast);
  handle = createRequestHandler({ token: "secret", acp, broadcast, preparation: service });
});
beforeEach(() => {
  db().exec(`DELETE FROM application_transitions; DELETE FROM application_events; DELETE FROM pdf_artifacts;
    UPDATE applications SET preparation_run_id = NULL, previous_application_id = NULL;
    DELETE FROM application_runs; DELETE FROM applications; DELETE FROM jobs;`);
  broadcast.mockClear();
});
afterAll(async () => {
  await service.close();
  closeDb();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});

test("CLI add resolves local and external job IDs and repeats without another application or transition", async () => {
  saveJob(1, "li-1");
  const first = await cli("application", "add", "--job-id", "1", "--resume-path", "/fixture/resume.pdf", "--status", "draft");
  expect(first).toMatchObject({ code: 0, stdout: expect.stringMatching(/application #\d+ added/) });
  const id = Number(/#(\d+)/.exec(first.stdout)![1]);
  // A tailored resume is preparation only; it never counts as a submission.
  expect(journey(id)).toMatchObject({ job_id: 1, origin: "agent", attempt: 1, preparation_status: "ready", submission_status: "not_submitted", status: "draft" });
  const history = transitions(id);
  expect(await cli("application", "add", "--job-id", "1", "--resume-path", "/fixture/resume.pdf")).toMatchObject({ code: 0, stdout: `application #${id} reused (attempt 1)\n` });
  expect(await cli("application", "add", "--linkedin-job-id", "li-1")).toMatchObject({ code: 0, stdout: `application #${id} reused (attempt 1)\n` });
  expect(count("applications")).toBe(1);
  expect(transitions(id)).toEqual(history);
  const missing = await cli("application", "add", "--job-id", "1", "--linkedin-job-id", "li-404");
  expect(missing).toMatchObject({ code: 1, stderr: expect.stringContaining("No saved job has LinkedIn ID li-404") });
  expect(await cli("application", "add", "--job-id", "999")).toMatchObject({ code: 1, stderr: expect.stringContaining("Job #999 not found") });
  expect(count("applications")).toBe(1);
});

test("submitting through the API and through the CLI keeps the same invariants and repeats change nothing", async () => {
  saveJob(1, null);
  saveJob(2, null);
  const at = "2026-10-17T10:00:00.000Z";
  // API: an application filled by preparation run "run-api", confirmed by the candidate.
  db().query("INSERT INTO application_runs (id, job_id, status, phase, provider, created_at, updated_at) VALUES ('run-api', 1, 'completed', 'review', 'fake', ?, ?)").run(at, at);
  const apiId = db().transaction(() => {
    const { record } = store.openApplication(db(), { jobId: 1, origin: "preparation" });
    db().query("UPDATE applications SET preparation_run_id = 'run-api', fields_filled_json = '{}' WHERE id = ?").run(record.id);
    store.transition(db(), record.id, "prepare.complete", "agent");
    store.transition(db(), record.id, "fill.complete", "agent");
    return record.id;
  })();
  db().query("UPDATE application_runs SET application_id = ? WHERE id = 'run-api'").run(apiId);
  db().query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES ('pdf-api', 'run-api', 'tailored', '/fixture/resume.pdf', 1, '', '[]')").run();
  // CLI: the same journey recorded by an agent skill.
  const added = await cli("application", "add", "--job-id", "2", "--resume-path", "/fixture/resume.pdf", "--status", "filled");
  const cliId = Number(/#(\d+)/.exec(added.stdout)![1]);
  const before = { api: transitions(apiId).length, cli: transitions(cliId).length };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await post("/api/application-preparation/submitted", { runId: "run-api" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, alreadySubmitted: attempt > 0, applicationId: apiId });
    expect(await cli("application", "update", "--id", String(cliId), "--status", "submitted")).toMatchObject({ code: 0 });
  }
  for (const id of [apiId, cliId]) {
    expect(journey(id)).toMatchObject({ preparation_status: "ready", fill_status: "filled", submission_status: "submitted", status: "submitted", attempt: 1 });
    expect(journey(id).submitted_at).toEqual(expect.any(String));
    expect(transitions(id).filter((row) => row.action === "submit")).toHaveLength(1);
  }
  expect(transitions(apiId).length).toBe(before.api + 1);
  expect(transitions(cliId).length).toBe(before.cli + 1);
  expect(transitions(apiId).at(-1)).toEqual({ action: "submit", actor: "api" });
  expect(transitions(cliId).at(-1)).toEqual({ action: "submit", actor: "cli" });
  expect(count("applications")).toBe(2);

  // A submission is never undone and its documents stay locked.
  const draft = await cli("application", "update", "--id", String(cliId), "--status", "draft");
  expect(draft).toMatchObject({ code: 1, stderr: expect.stringContaining("cannot return to draft") });
  const regenerate = await post("/api/application-preparation/generate", { jobId: 1, applicationId: apiId, provider: "fake" });
  expect(regenerate.status).toBe(409);
  expect(await regenerate.json()).toEqual({ error: expect.stringContaining("already submitted") });
  expect(journey(cliId).status).toBe("submitted");
  expect(count("application_runs")).toBe(1);
});

test("a repeated board registration returns the first record, and moving the card keeps the submission", async () => {
  const body = { company_name: "Example Corp", external_url: "https://jobs.example.test/manual", applied_at: "2026-10-01T12:00:00.000Z", request_id: "form-1" };
  const first = await post("/api/application-board/create", body);
  const repeat = await post("/api/application-board/create", body);
  expect([first.status, repeat.status]).toEqual([201, 200]);
  const record = (await first.json()) as { id: number; current_stage_id: number };
  expect(await repeat.json()).toEqual(record);
  expect(count("applications")).toBe(1);
  expect(count("application_events WHERE application_id = ?", record.id)).toBe(1);
  expect(transitions(record.id)).toEqual([{ action: "submit", actor: "api" }]);
  expect(journey(record.id)).toMatchObject({ origin: "manual", submission_status: "submitted", submitted_at: "2026-10-01T12:00:00.000Z" });
  const technical = db().query("SELECT id FROM application_stages WHERE key = 'technical'").get() as { id: number };
  expect((await post("/api/application-board/move", { id: record.id, stage_id: technical.id })).status).toBe(200);
  expect((await post("/api/application-board/archive", { id: record.id, reason: "rejected" })).status).toBe(200);
  expect(journey(record.id)).toMatchObject({ submission_status: "submitted", submitted_at: "2026-10-01T12:00:00.000Z", status: "submitted" });
  // Registrations without a request key are distinct, even for the same company and title.
  await post("/api/application-board/create", { ...body, request_id: undefined });
  expect(count("applications")).toBe(2);
});

test("a new attempt for a republished job is an explicit decision allowed only after submission", async () => {
  saveJob(1, null);
  const first = await cli("application", "add", "--job-id", "1");
  const id = Number(/#(\d+)/.exec(first.stdout)![1]);
  const early = await cli("application", "add", "--job-id", "1", "--new-attempt");
  expect(early).toMatchObject({ code: 1, stderr: expect.stringContaining("not submitted yet") });
  expect(count("applications")).toBe(1);
  await cli("application", "update", "--id", String(id), "--status", "submitted");
  const retry = await cli("application", "add", "--job-id", "1", "--new-attempt", "--idempotency-key", "retry-1");
  const retryId = Number(/#(\d+)/.exec(retry.stdout)![1]);
  expect(retry.stdout).toBe(`application #${retryId} added\n`);
  expect(journey(retryId)).toMatchObject({ job_id: 1, attempt: 2, previous_application_id: id, submission_status: "not_submitted" });
  expect(await cli("application", "add", "--job-id", "1", "--new-attempt", "--idempotency-key", "retry-1")).toMatchObject({ stdout: `application #${retryId} reused (attempt 2)\n` });
  expect(journey(id)).toMatchObject({ attempt: 1, submission_status: "submitted" });
  expect(count("applications")).toBe(2);
});

test("the v4 migration keeps IDs, events and links, flags ambiguous rows and applies the republication rule", () => {
  const legacy = new Database(join(home, "legacy-v2.db"));
  legacy.exec(readFileSync(join(import.meta.dirname, "../fixtures/legacy-workspace-v2.sql"), "utf8"));
  // Extra legacy rows: an unsubmitted duplicate for job 11 and an agent status with no meaning.
  legacy.exec(`INSERT INTO applications (id, job_id, status) VALUES (51, 11, 'draft'), (52, 17, 'applied');`);
  const events = legacy.query("SELECT * FROM application_events ORDER BY id").all();
  migrateDatabase(legacy, { backupDir: join(home, "backups") });
  expect(legacy.query("SELECT * FROM application_events ORDER BY id").all()).toEqual(events);
  expect(legacy.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(legacy.query("SELECT id, job_id, attempt, submission_status, review_reason, status FROM applications ORDER BY id").all()).toEqual([
    { id: 21, job_id: 11, attempt: 1, submission_status: "submitted", review_reason: null, status: "submitted" },
    { id: 34, job_id: null, attempt: 1, submission_status: "submitted", review_reason: null, status: "submitted" },
    { id: 51, job_id: 11, attempt: 2, submission_status: "not_submitted", review_reason: "duplicate_job", status: "draft" },
    { id: 52, job_id: 17, attempt: 1, submission_status: "not_submitted", review_reason: "unknown_status", status: "applied" },
  ]);
  legacy.transaction(() => {
    // Job 11 keeps reusing its latest attempt; a new one waits for that attempt's submission.
    expect(store.openApplication(legacy, { jobId: 11, origin: "agent" })).toMatchObject({ created: false, record: { id: 51 } });
    expect(() => store.openApplication(legacy, { jobId: 11, origin: "agent", newAttempt: true })).toThrow("Application #51");
    store.transition(legacy, 51, "submit", "cli");
    expect(store.openApplication(legacy, { jobId: 11, origin: "agent", newAttempt: true }).record).toMatchObject({ attempt: 3, previous_application_id: 51 });
  })();
  legacy.close();
});
