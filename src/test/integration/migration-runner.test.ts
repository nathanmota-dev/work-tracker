/**
 * Migration runner semantics against real SQLite: transactions, rollback,
 * foreign-key checks and row invariants. Workspaces are temporary files.
 */
import { afterAll, expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { IncompatibleSchemaError, MIGRATIONS, MigrationIntegrityError, migrateDatabase, type Migration } from "../../db/migrations.ts";
import { SCHEMA_VERSION } from "../../db/schema.ts";

const home = mkdtempSync(join(tmpdir(), "work-tracker-runner-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const clock = () => new Date("2026-10-16T12:00:00.000Z");
const options = { backupDir: join(home, "backups"), clock };
let files = 0;
const open = () => {
  const d = new Database(join(home, `runner-${files++}.db`));
  d.exec("PRAGMA foreign_keys = ON;");
  return d;
};
const value = (d: Database, sql: string) => Object.values(d.query(sql).get() as object)[0];
const version = (d: Database) => value(d, "SELECT value FROM meta WHERE key = 'schema_version'");
const step = (v: number, up: Migration["up"], extra: Partial<Migration> = {}): Migration => ({ version: v, name: `step ${v}`, up, ...extra });
const current = () => {
  const d = open();
  migrateDatabase(d, options);
  return d;
};

test("creates a new database at the latest version without running steps", () => {
  const d = open();
  expect(migrateDatabase(d, options)).toEqual({ mode: "created", from: null, to: SCHEMA_VERSION, applied: [], backup: null });
  expect(version(d)).toBe(String(SCHEMA_VERSION));
  expect(d.query("SELECT version, name, applied_at FROM schema_migrations").all()).toEqual([
    { version: 3, name: "legacy additive baseline", applied_at: "2026-10-16T12:00:00.000Z" },
  ]);
  expect(value(d, "SELECT COUNT(*) FROM outreach_budget")).toBe(1);
});
test("upgrades an unversioned legacy workspace in place, keeping IDs and links", () => {
  const d = open();
  d.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT NOT NULL DEFAULT 'saved');
    CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER REFERENCES jobs(id), status TEXT);
    INSERT INTO jobs (id, title) VALUES (41, 'Engineer');
    INSERT INTO applications (id, job_id, status) VALUES (7, 41, 'applied');`);
  expect(migrateDatabase(d, options)).toEqual({ mode: "migrated", from: 0, to: 3, applied: [3], backup: null });
  expect(d.query("SELECT id, job_id, status, current_stage_id FROM applications").all()).toEqual([
    { id: 7, job_id: 41, status: "applied", current_stage_id: null },
  ]);
  expect(value(d, "PRAGMA foreign_keys")).toBe(1);
  expect(existsSync(options.backupDir)).toBe(false);
});
test("an up-to-date workspace only receives additive changes and repeated opens add nothing", () => {
  const d = current();
  d.exec("DELETE FROM outreach_budget");
  expect(migrateDatabase(d, options)).toEqual({ mode: "current", from: 3, to: 3, applied: [], backup: null });
  expect(migrateDatabase(d, options).mode).toBe("current");
  expect(value(d, "SELECT COUNT(*) FROM outreach_budget")).toBe(1);
  expect(value(d, "SELECT COUNT(*) FROM application_stages")).toBe(4);
});
test("runs pending steps in order, records each one and snapshots before incompatible steps", () => {
  const d = current();
  const order: number[] = [];
  const plan = [
    ...MIGRATIONS,
    step(4, () => order.push(4)),
    step(5, (db) => { order.push(5); db.exec("ALTER TABLE jobs RENAME COLUMN comp TO compensation"); }, { incompatible: true }),
  ];
  const backup = join(options.backupDir, "work-tracker-v3-to-v5-2026-10-16T12-00-00-000Z.db");
  expect(migrateDatabase(d, { ...options, migrations: plan, target: 5 })).toEqual({
    mode: "migrated", from: 3, to: 5, applied: [4, 5], backup,
  });
  expect(order).toEqual([4, 5]);
  const copy = new Database(backup);
  expect(version(copy)).toBe("3");
  expect(copy.query("PRAGMA table_info(jobs)").all()).toContainEqual(expect.objectContaining({ name: "comp" }));
  copy.close();
  expect(d.query("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 3 }, { version: 4 }, { version: 5 }]);
  expect(version(d)).toBe("5");
});
test("a failed snapshot stops the migration before any step runs", () => {
  const d = current();
  const up = vi.fn();
  const blocked = join(home, "not-a-directory");
  writeFileSync(blocked, "");
  expect(() => migrateDatabase(d, { ...options, backupDir: blocked, migrations: [...MIGRATIONS, step(4, up, { incompatible: true })], target: 4 })).toThrow();
  expect(up).not.toHaveBeenCalled();
  expect(readdirSync(home).filter((name) => name.endsWith(".partial"))).toEqual([]);
  expect(version(d)).toBe("3");
});
test.each([
  ["a step throws", step(5, () => { throw new Error("boom"); })],
  ["a verification fails", step(5, () => {}, { verify: () => { throw new Error("invariant"); } })],
  ["rows are lost", step(5, (db) => db.exec("DELETE FROM jobs"))],
  ["a table disappears", step(5, (db) => db.exec("DROP TABLE legacy_notes"))],
  ["links break", step(5, (db) => db.exec("INSERT INTO applications (id, job_id) VALUES (9, 404)"))],
])("rolls back every pending step when %s", (_case, failing) => {
  const d = current();
  d.exec("INSERT INTO jobs (id, title) VALUES (1, 'Kept'); CREATE TABLE legacy_notes (body TEXT)");
  const plan = [...MIGRATIONS, step(4, (db) => db.exec("UPDATE jobs SET title = 'Changed'")), failing];
  expect(() => migrateDatabase(d, { ...options, migrations: plan, target: 5 })).toThrow();
  expect(version(d)).toBe("3");
  expect(value(d, "SELECT title FROM jobs WHERE id = 1")).toBe("Kept");
  expect(value(d, "SELECT COUNT(*) FROM schema_migrations WHERE version > 3")).toBe(0);
  expect(value(d, "SELECT COUNT(*) FROM applications")).toBe(0);
  expect(value(d, "SELECT COUNT(*) FROM legacy_notes")).toBe(0);
  expect(value(d, "PRAGMA foreign_keys")).toBe(1);
});
test("reports integrity failures as MigrationIntegrityError and tolerates links broken before migrating", () => {
  const d = current();
  d.exec("PRAGMA foreign_keys = OFF; INSERT INTO applications (id, job_id) VALUES (1, 500); PRAGMA foreign_keys = ON;");
  const plan = [...MIGRATIONS, step(4, () => {})];
  expect(migrateDatabase(d, { ...options, migrations: plan, target: 4 }).applied).toEqual([4]);
  const breaking = [...plan, step(5, (db) => db.exec("INSERT INTO interviews (company, job_id) VALUES ('x', 9)"))];
  expect(() => migrateDatabase(d, { ...options, migrations: breaking, target: 5 })).toThrow(MigrationIntegrityError);
  expect(() => migrateDatabase(d, { ...options, migrations: breaking, target: 5 })).toThrow("broke 1 foreign key link(s): interviews");
});
test("refuses a damaged database before changing it", () => {
  const d = current();
  const query = d.query.bind(d);
  vi.spyOn(d, "query").mockImplementation((sql) => sql === "PRAGMA quick_check" ? { ...query("SELECT 1"), get: () => ({ quick_check: "corrupt" }) } : query(sql));
  expect(() => migrateDatabase(d, { ...options, migrations: [...MIGRATIONS, step(4, () => {})], target: 4 })).toThrow("integrity check failed before migration: corrupt");
  vi.mocked(d.query).mockImplementation((sql) => sql === "PRAGMA quick_check" ? { ...query("SELECT 1"), get: () => undefined } : query(sql));
  expect(() => migrateDatabase(d, { ...options, migrations: [...MIGRATIONS, step(4, () => {})], target: 4 })).toThrow("no result");
  expect(version(d)).toBe("3");
});
test.each([
  ["99", "newer than this Work Tracker supports (v3)"],
  ["three", 'Unrecognized workspace schema version "three"'],
  [null, 'Unrecognized workspace schema version "null"'],
])("refuses schema version %s without modifying the database", (stored, message) => {
  const d = current();
  d.query("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(stored);
  expect(() => migrateDatabase(d, options)).toThrow(IncompatibleSchemaError);
  expect(() => migrateDatabase(d, options)).toThrow(message);
  expect(value(d, "SELECT value FROM meta WHERE key = 'schema_version'")).toBe(stored);
});
test("a workspace with a meta table but no version is treated as legacy", () => {
  const d = open();
  d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  expect(migrateDatabase(d, options)).toMatchObject({ from: 0, applied: [3] });
});
test.each([
  [[step(2, () => {}), step(2, () => {})], 2, "greater than 2"],
  [[step(1.5, () => {})], 1.5, "integer version greater than 0"],
  [[step(1, () => {})], 2, "last migration (v1) must match the target schema v2"],
  [[], 1, "last migration (v0)"],
])("rejects an invalid migration plan", (migrations, target, message) => {
  expect(() => migrateDatabase(open(), { ...options, migrations, target })).toThrow(message);
});
