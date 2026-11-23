import { afterAll, beforeAll, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { IncompatibleSchemaError, MIGRATIONS, migrateDatabase, type Migration } from "../../db/migrations.ts";
import { SCHEMA_VERSION } from "../../db/schema.ts";

const home = mkdtempSync(join(tmpdir(), "work-tracker-migrations-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
const backupDir = join(home, "backups");
const fixture = readFileSync(join(import.meta.dirname, "../fixtures/legacy-workspace-v2.sql"), "utf8");
const legacyTables = ["companies", "jobs", "application_stages", "applications", "application_events", "interviews", "outreach_budget"];
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;

const all = (d: Database, sql: string) => d.query(sql).all() as Record<string, unknown>[];
const value = (d: Database, sql: string) => Object.values(d.query(sql).get() as object)[0];
const dump = (d: Database, tables = legacyTables) =>
  Object.fromEntries(tables.map((table) => [table, all(d, `SELECT * FROM ${table} ORDER BY rowid`)]));
const workspace = (name: string, setup?: (d: Database) => void) => {
  const d = new Database(join(home, `${name}.db`));
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrateDatabase(d, { backupDir });
  setup?.(d);
  return d;
};
const seedJourney = (d: Database) => d.exec(`
  INSERT INTO jobs (id, title, company_name) VALUES (12, 'Data Engineer', 'Example Corp');
  INSERT INTO applications (id, job_id, current_stage_id, tracking_status) VALUES (40, 12, 1, 'active');
  INSERT INTO application_events (id, application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
    VALUES (200, 40, 'created', 1, 'Applied', 'applied', '2026-03-01T00:00:00Z');
  INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at)
    VALUES ('run-1', 12, 40, 'done', 'review', 'fake', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
  INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json)
    VALUES ('pdf-1', 'run-1', 'resume', '/fixture/resume.pdf', 1, 'Synthetic resume', '[]');
  INSERT INTO interviews (id, company, job_id, stage) VALUES (6, 'Example Corp', 12, 'recruiter');`);
// Incompatible on purpose: rebuilds interviews with a required status column (SQLite 12-step pattern).
const rebuildInterviews: Migration = {
  version: SCHEMA_VERSION + 1,
  name: "rebuild interviews",
  incompatible: true,
  up: (d) => d.exec(`
    CREATE TABLE interviews_next (id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL,
      job_id INTEGER REFERENCES jobs(id), scheduled_at TEXT, stage TEXT, status TEXT NOT NULL DEFAULT 'scheduled', notes TEXT);
    INSERT INTO interviews_next SELECT id, company, job_id, scheduled_at, stage, COALESCE(status, 'scheduled'), notes FROM interviews;
    DROP TABLE interviews;
    ALTER TABLE interviews_next RENAME TO interviews;`),
};

beforeAll(async () => {
  const legacy = new Database(join(home, "work-tracker.db"));
  legacy.exec(fixture);
  legacy.close();
  ({ db, closeDb } = await import("../../db/index.ts"));
});
afterAll(() => {
  closeDb();
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

test("opening a v2 workspace keeps IDs, links, history and artifacts; reopening adds nothing", () => {
  const legacy = new Database(join(home, "work-tracker.db"));
  const before = dump(legacy);
  legacy.close();
  const d = db();
  expect(value(d, "SELECT value FROM meta WHERE key = 'schema_version'")).toBe(String(SCHEMA_VERSION));
  // Only the legacy status summary of board record 34 is rewritten (draft -> submitted).
  before.applications = before.applications!.map((row) => (row.id === 34 ? { ...row, status: "submitted" } : row));
  for (const [table, rows] of Object.entries(before))
    expect(all(d, `SELECT * FROM ${table} ORDER BY rowid`), table).toMatchObject(rows);
  expect(all(d, `SELECT id, origin, attempt, preparation_status, fill_status, submission_status, submitted_at, review_reason
    FROM applications ORDER BY id`)).toEqual([
    { id: 21, origin: "unknown", attempt: 1, preparation_status: "ready", fill_status: "not_started", submission_status: "submitted", submitted_at: "2026-01-03T09:00:00Z", review_reason: null },
    { id: 34, origin: "manual", attempt: 1, preparation_status: "not_started", fill_status: "not_started", submission_status: "submitted", submitted_at: null, review_reason: null },
  ]);
  expect(all(d, "SELECT id, job_id, current_stage_id, resume_path FROM applications ORDER BY id")).toEqual([
    { id: 21, job_id: 11, current_stage_id: 9, resume_path: "/fixture/artifacts/21/resume.pdf" },
    { id: 34, job_id: null, current_stage_id: 1, resume_path: null },
  ]);
  expect(all(d, "PRAGMA foreign_key_check")).toEqual([]);
  expect(all(d, "SELECT version FROM schema_migrations")).toEqual(MIGRATIONS.map((step) => ({ version: step.version })));
  expect(all(d, "PRAGMA table_info(applications)").map((c) => c.name)).toContain("preparation_run_id");
  const migrated = dump(d, [...legacyTables, "schema_migrations", "meta"]);
  closeDb();
  expect(dump(db(), [...legacyTables, "schema_migrations", "meta"])).toEqual(migrated);
  // The journey step rewrites data, so the v2 workspace was snapshotted first.
  const [snapshot] = readdirSync(join(home, "backups"));
  expect(snapshot).toMatch(new RegExp(`^work-tracker-v2-to-v${SCHEMA_VERSION}-`));
  const copy = new Database(join(home, "backups", snapshot!));
  expect(value(copy, "SELECT value FROM meta WHERE key = 'schema_version'")).toBe("2");
  copy.close();
});

test("a failure in a later step rolls back the whole run; a retry applies each step once", () => {
  const d = workspace("rollback", seedJourney);
  const before = dump(d, [...legacyTables, "schema_migrations", "meta"]);
  const next = SCHEMA_VERSION + 1;
  const addNote: Migration = { version: next, name: "add note", up: (db) => db.exec("UPDATE applications SET notes = 'migrated' WHERE id = 40; INSERT INTO companies (name) VALUES ('Added once')") };
  const failing: Migration = { version: next + 1, name: "failing", up: () => { throw new Error("injected failure"); } };
  expect(() => migrateDatabase(d, { backupDir, migrations: [...MIGRATIONS, addNote, failing], target: next + 1 })).toThrow("injected failure");
  expect(dump(d, [...legacyTables, "schema_migrations", "meta"])).toEqual(before);
  expect(value(d, "PRAGMA foreign_keys")).toBe(1);
  const fixed = [...MIGRATIONS, addNote, { ...failing, up: () => {} }];
  expect(migrateDatabase(d, { backupDir, migrations: fixed, target: next + 1 })).toMatchObject({ mode: "migrated", from: SCHEMA_VERSION, applied: [next, next + 1] });
  expect(migrateDatabase(d, { backupDir, migrations: fixed, target: next + 1 })).toMatchObject({ mode: "current", applied: [] });
  expect(value(d, "SELECT COUNT(*) FROM companies WHERE name = 'Added once'")).toBe(1);
  expect(all(d, "SELECT version FROM schema_migrations ORDER BY version")).toEqual([...MIGRATIONS.map((step) => step.version), next, next + 1].map((version) => ({ version })));
  expect(value(d, "SELECT notes FROM applications WHERE id = 40")).toBe("migrated");
  d.close();
});

test("an incompatible step first writes a consistent snapshot of the WAL workspace that opens intact", () => {
  const d = workspace("snapshot", (db) => { db.exec("PRAGMA wal_autocheckpoint = 0;"); seedJourney(db); });
  expect(statSync(join(home, "snapshot.db-wal")).size).toBeGreaterThan(0);
  const tables = [...legacyTables, "application_runs", "pdf_artifacts"];
  const before = dump(d, tables);
  const result = migrateDatabase(d, { backupDir, migrations: [...MIGRATIONS, rebuildInterviews], target: rebuildInterviews.version });
  expect(result.backup).toMatch(new RegExp(`work-tracker-v${SCHEMA_VERSION}-to-v${SCHEMA_VERSION + 1}-.*\\.db$`));
  expect(dump(d, tables)).toEqual(before);
  expect(all(d, "PRAGMA foreign_key_check")).toEqual([]);
  d.close();
  const copy = new Database(result.backup!);
  expect(value(copy, "PRAGMA quick_check")).toBe("ok");
  expect(all(copy, "PRAGMA foreign_key_check")).toEqual([]);
  expect(value(copy, "SELECT value FROM meta WHERE key = 'schema_version'")).toBe(String(SCHEMA_VERSION));
  expect(dump(copy, tables)).toEqual(before);
  copy.close();
  expect(existsSync(`${result.backup}-wal`)).toBe(false);
});

test("a snapshot is kept and the workspace untouched when the incompatible step fails", () => {
  const d = workspace("failed-incompatible", seedJourney);
  const before = dump(d, [...legacyTables, "meta"]);
  const failing = { ...rebuildInterviews, up: (db: Database) => { rebuildInterviews.up(db); throw new Error("after rebuild"); } };
  const snapshots = readdirSync(backupDir).length;
  expect(() => migrateDatabase(d, { backupDir, migrations: [...MIGRATIONS, failing], target: failing.version })).toThrow("after rebuild");
  expect(dump(d, [...legacyTables, "meta"])).toEqual(before);
  expect(readdirSync(backupDir)).toHaveLength(snapshots + 1);
  d.close();
});

test("a workspace from a future version is refused by db() without being modified", () => {
  closeDb();
  const raw = new Database(join(home, "work-tracker.db"));
  raw.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
  const before = dump(raw, [...legacyTables, "meta", "schema_migrations"]);
  raw.close();
  expect(() => db()).toThrow(IncompatibleSchemaError);
  expect(() => db()).toThrow("newer than this Work Tracker supports");
  const after = new Database(join(home, "work-tracker.db"));
  expect(dump(after, [...legacyTables, "meta", "schema_migrations"])).toEqual(before);
  after.exec(`UPDATE meta SET value = '${SCHEMA_VERSION}' WHERE key = 'schema_version'`);
  after.close();
  expect(value(db(), "SELECT COUNT(*) FROM applications")).toBe(2);
});

test("v10 triage backfills existing rows once and leaves subsequent inserts new", () => {
  const d = workspace("triage-v9");
  d.exec("INSERT INTO jobs (title, company_name) VALUES ('Existing', 'Acme'); UPDATE meta SET value = '9' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 10;");
  const result = migrateDatabase(d, { backupDir });
  expect(result.applied).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  expect(result.backup).toBeTruthy();
  expect(value(d, "SELECT shortlisted_at FROM jobs")).toEqual(expect.any(String));
  d.exec("INSERT INTO jobs (title, company_name) VALUES ('New', 'Acme')");
  migrateDatabase(d, { backupDir });
  expect(value(d, "SELECT shortlisted_at FROM jobs WHERE title = 'New'")).toBeNull();
  d.close();
});

test("v13 deadlines add nullable columns to a v12 workspace, keep IDs and data, and rerun as a no-op", () => {
  const d = workspace("deadlines-v12", seedJourney);
  d.exec(`ALTER TABLE jobs DROP COLUMN deadline; ALTER TABLE applications DROP COLUMN deadline;
    UPDATE meta SET value = '12' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 13;`);
  const before = dump(d, ["jobs", "applications", "application_events", "interviews"]);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ from: 12, to: SCHEMA_VERSION, applied: [13, 14, 15, 16, 17, 18] });
  const after = dump(d, ["jobs", "applications", "application_events", "interviews"]);
  expect(after.jobs).toEqual(before.jobs!.map((row) => ({ ...row, deadline: null })));
  expect(after.applications).toEqual(before.applications!.map((row) => ({ ...row, deadline: null })));
  expect(after.application_events).toEqual(before.application_events);
  d.exec("UPDATE jobs SET deadline = '2026-12-01' WHERE id = 12");
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ mode: "current", applied: [] });
  expect(all(d, "SELECT id, deadline FROM jobs")).toEqual([{ id: 12, deadline: "2026-12-01" }]);
  expect(value(d, "SELECT COUNT(*) FROM schema_migrations WHERE version = 13")).toBe(1);
  d.close();
});

test("v15 company research adds an empty cache table to a v14 workspace without touching companies", () => {
  const d = workspace("company-research-v14", seedJourney);
  d.exec(`INSERT INTO companies (id, name, urn_id, notes) VALUES (5, 'Acme Corp', '1234', 'Recruiter notes');
    DROP TABLE company_research; UPDATE meta SET value = '14' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 15;`);
  const before = dump(d, ["companies", "jobs", "applications"]);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ from: 14, to: SCHEMA_VERSION, applied: [15, 16, 17, 18], backup: null });
  expect(dump(d, ["companies", "jobs", "applications"])).toEqual(before);
  expect(all(d, "SELECT name FROM pragma_table_info('company_research') ORDER BY cid")).toEqual(
    ["id", "company_key", "company_name", "fetched_at", "sources_json", "network_note", "summary_md"].map((name) => ({ name })),
  );
  d.exec("INSERT INTO company_research (company_key, company_name, fetched_at, sources_json) VALUES ('acme-corp', 'Acme Corp', '2026-11-01T00:00:00.000Z', '{}')");
  expect(() => d.exec("INSERT INTO company_research (company_key, company_name, fetched_at, sources_json) VALUES ('acme-corp', 'acme corp', 'x', '{}')")).toThrow(/UNIQUE/);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ mode: "current", applied: [] });
  expect(value(d, "SELECT COUNT(*) FROM company_research")).toBe(1);
  d.close();
});

test("v16 adds an empty follow-up drafts table to a v15 workspace without touching its records", () => {
  const d = workspace("followups-v15", seedJourney);
  d.exec(`DROP TABLE followup_drafts; UPDATE meta SET value = '15' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 16;`);
  const before = dump(d);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ from: 15, to: SCHEMA_VERSION, applied: [16, 17, 18], backup: null });
  expect(dump(d)).toEqual(before);
  expect(value(d, "SELECT COUNT(*) FROM followup_drafts")).toBe(0);
  expect(all(d, "PRAGMA index_list(followup_drafts)").map((index) => index.name)).toContain("idx_followup_drafts_application");
  expect(() => d.exec("INSERT INTO followup_drafts (application_id, kind, channel, body_md, created_at) VALUES (40, 'nudge', 'email', 'x', 'now')")).toThrow();
  d.exec("INSERT INTO followup_drafts (application_id, kind, channel, body_md, created_at) VALUES (40, 'follow_up', 'email', 'x', 'now')");
  expect(value(d, "SELECT status FROM followup_drafts")).toBe("draft");
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ mode: "current", applied: [] });
  d.close();
});

test("v17 adds an empty job rankings table to a v16 workspace, keeps its records and repeats as a no-op", () => {
  const d = workspace("rankings-v16", seedJourney);
  d.exec(`DROP TABLE job_rankings; UPDATE meta SET value = '16' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 17;`);
  const before = dump(d);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ from: 16, to: SCHEMA_VERSION, applied: [17, 18], backup: null });
  expect(dump(d)).toEqual(before);
  expect(value(d, "SELECT COUNT(*) FROM job_rankings")).toBe(0);
  expect(all(d, "PRAGMA index_list(job_rankings)").map((index) => index.name)).toContain("idx_job_rankings_status");
  const job = value(d, "SELECT id FROM jobs ORDER BY id LIMIT 1");
  expect(() => d.exec(`INSERT INTO job_rankings (job_id, status, ranked_at) VALUES (${job}, 'closed', 'now')`)).toThrow();
  expect(() => d.exec(`INSERT INTO job_rankings (job_id, status, technical, ranked_at) VALUES (${job}, 'scored', 101, 'now')`)).toThrow();
  d.exec(`INSERT INTO job_rankings (job_id, status, ranked_at) VALUES (${job}, 'unreachable', 'now')`);
  expect(all(d, "SELECT fetch_attempts, strengths_json, gaps_json FROM job_rankings")).toEqual([{ fetch_attempts: 0, strengths_json: "[]", gaps_json: "[]" }]);
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ mode: "current", applied: [] });
  expect(value(d, "SELECT COUNT(*) FROM schema_migrations WHERE version = 17")).toBe(1);
  d.close();
});

test("v18 adds the requirement gates to a v17 workspace: jobs stay unchecked and a rerun adds nothing", () => {
  const d = workspace("gates-v17", seedJourney);
  d.exec(`DROP TABLE candidate_languages; DROP TABLE gate_profile; ALTER TABLE jobs DROP COLUMN gate_json;
    UPDATE meta SET value = '17' WHERE key = 'schema_version'; DELETE FROM schema_migrations WHERE version = 18;`);
  const jobs = all(d, "SELECT * FROM jobs ORDER BY id");
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ from: 17, to: SCHEMA_VERSION, applied: [18], backup: null });
  expect(all(d, "SELECT * FROM jobs ORDER BY id")).toEqual(jobs.map((job) => ({ ...job, gate_json: null })));
  expect(value(d, "SELECT COUNT(*) FROM candidate_languages")).toBe(0);
  expect(value(d, "SELECT COUNT(*) FROM gate_profile")).toBe(0);
  expect(() => d.exec("INSERT INTO gate_profile (id, eligibility, updated_at) VALUES (1, 'tourist', 'now')")).toThrow();
  expect(() => d.exec("INSERT INTO gate_profile (id, eligibility, updated_at) VALUES (2, NULL, 'now')")).toThrow();
  expect(migrateDatabase(d, { backupDir })).toMatchObject({ mode: "current", applied: [] });
  expect(all(d, "PRAGMA table_info(jobs)").filter((column) => column.name === "gate_json")).toHaveLength(1);
  expect(value(d, "SELECT COUNT(*) FROM schema_migrations WHERE version = 18")).toBe(1);
  d.close();
});
