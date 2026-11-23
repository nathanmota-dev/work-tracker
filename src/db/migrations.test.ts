import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { ensureCurrentSchema } from "./current-schema.ts";
import { snapshotDatabase } from "./snapshot.ts";
import { IncompatibleSchemaError, MIGRATIONS, MigrationIntegrityError, migrateDatabase, type Migration } from "./migrations.ts";
import { MIGRATION_TABLES_SQL, SCHEMA_VERSION } from "./schema.ts";
import { backfillJourney, verifyJourney } from "./journey-backfill.ts";
vi.mock("./current-schema.ts", () => ({ ensureCurrentSchema: vi.fn() }));
vi.mock("./journey-backfill.ts", () => ({ backfillJourney: vi.fn(), verifyJourney: vi.fn() }));
vi.mock("./snapshot.ts", () => ({ snapshotDatabase: vi.fn((_d: unknown, path: string) => path) }));

type State = {
  tables: string[];
  version: { value: string | null } | undefined;
  health: { quick_check: string } | undefined;
  violations: { table: string; rowid: number; parent: string; fkid: number }[];
  counts: Record<string, number>;
};
let state: State, d: ReturnType<typeof databaseDouble>, log: string[];
const clock = () => new Date("2026-10-16T12:00:00.000Z");
// Runner semantics are pinned to the v3 baseline; the real plan is covered at the end.
const baseline = MIGRATIONS.filter((migration) => migration.version <= 3);
const options = { backupDir: "/home/backups", clock, migrations: baseline, target: 3 };
const step = (version: number, up: Migration["up"] = () => log.push(`up ${version}`), extra: Partial<Migration> = {}): Migration =>
  ({ version, name: `step ${version}`, up, ...extra });
const plan = (...steps: Migration[]) => ({ ...options, migrations: [...baseline, ...steps], target: steps.at(-1)!.version });
const writes = () => d.statement.run.mock.calls as unknown[][];

/** Answers the runner's catalog, pragma and count queries from `state`. */
beforeEach(() => {
  log = [];
  state = { tables: ["jobs", "meta"], version: { value: "3" }, health: { quick_check: "ok" }, violations: [], counts: { jobs: 2, meta: 1 } };
  d = databaseDouble();
  d.exec.mockImplementation((sql: string) => log.push(sql));
  d.query.mockImplementation((sql: string) => {
    if (sql.includes("sqlite_master")) d.statement.all.mockReturnValueOnce(state.tables.map((name) => ({ name })));
    if (sql.includes("foreign_key_check")) d.statement.all.mockReturnValueOnce(state.violations);
    if (sql.includes("FROM meta")) d.statement.get.mockReturnValueOnce(state.version);
    if (sql.includes("quick_check")) d.statement.get.mockReturnValueOnce(state.health);
    if (sql.includes("table_info(jobs)")) d.statement.all.mockReturnValueOnce([{ name: "scouted_at" }]);
    if (sql.includes("COUNT(*)")) d.statement.get.mockReturnValueOnce({ n: state.counts[/FROM "(.+)"/.exec(sql)![1]!] });
    return d.statement;
  });
  vi.mocked(ensureCurrentSchema).mockImplementation(() => log.push("ensure"));
});

test("creates an empty database at the latest version and records the whole history", () => {
  state.tables = [];
  expect(migrateDatabase(d.asDatabase, { backupDir: "/b", clock })).toEqual({ mode: "created", from: null, to: SCHEMA_VERSION, applied: [], backup: null });
  expect(log).toEqual(["ensure"]);
  expect(backfillJourney).not.toHaveBeenCalled();
  expect(writes()).toEqual([
    [3, "legacy additive baseline", "2026-10-16T12:00:00.000Z"],
    [4, "application journey model", "2026-10-16T12:00:00.000Z"],
    [5, "external job identity", "2026-10-16T12:00:00.000Z"],
    [6, "reusable answer languages", "2026-10-16T12:00:00.000Z"],
    [7, "document review versions", "2026-10-16T12:00:00.000Z"],
    [8, "preparation batch queue", "2026-10-16T12:00:00.000Z"],
    [9, "idempotent batch requests", "2026-10-16T12:00:00.000Z"],
    [10, "job triage", "2026-10-16T12:00:00.000Z"],
    [11, "onboarding preferences", "2026-10-16T12:00:00.000Z"],
    [12, "interview preparation packs", "2026-10-16T12:00:00.000Z"],
    [13, "posting integrity guard", "2026-10-16T12:00:00.000Z"],
    [String(SCHEMA_VERSION)],
  ]);
  expect(d.transaction).toHaveBeenCalledOnce();
});
test("a current workspace only receives additive changes", () => {
  expect(migrateDatabase(d.asDatabase, { ...options, backupDir: "/b" })).toEqual({ mode: "current", from: 3, to: 3, applied: [], backup: null });
  expect(log).toEqual(["ensure"]);
  expect(writes()).toEqual([]);
  expect(d.query).not.toHaveBeenCalledWith("PRAGMA quick_check");
});
test.each([
  ["no meta table", ["jobs"], undefined],
  ["no version row", ["jobs", "meta"], undefined],
])("treats a workspace with %s as legacy v0 and upgrades it with checks around one transaction", (_case, tables, version) => {
  state.tables = tables;
  state.version = version;
  expect(migrateDatabase(d.asDatabase, options)).toEqual({ mode: "migrated", from: 0, to: 3, applied: [3], backup: null });
  expect(log).toEqual(["PRAGMA foreign_keys = OFF;", MIGRATION_TABLES_SQL, "ensure", "ensure", "PRAGMA foreign_keys = ON;"]);
  expect(writes()).toEqual([[3, "legacy additive baseline", "2026-10-16T12:00:00.000Z"], ["3"]]);
  expect(d.query.mock.calls.filter(([sql]) => sql === "PRAGMA quick_check")).toHaveLength(2);
  expect(snapshotDatabase).not.toHaveBeenCalled();
});
test("snapshots before incompatible steps, runs steps in order and verifies them before stamping", () => {
  vi.mocked(snapshotDatabase).mockImplementation((_d, path) => { log.push("snapshot"); return path; });
  const result = migrateDatabase(d.asDatabase, plan(step(4, undefined, { verify: () => log.push("verify 4") }), step(5, undefined, { incompatible: true })));
  expect(result).toEqual({ mode: "migrated", from: 3, to: 5, applied: [4, 5], backup: "/home/backups/work-tracker-v3-to-v5-2026-10-16T12-00-00-000Z.db" });
  expect(log).toEqual(["snapshot", "PRAGMA foreign_keys = OFF;", MIGRATION_TABLES_SQL, "up 4", "up 5", "ensure", "verify 4", "PRAGMA foreign_keys = ON;"]);
  expect(writes().map((args) => args[0])).toEqual([4, 5, "5"]);
});
test("skips steps another process applied after the first version read", () => {
  d.exec.mockImplementation((sql: string) => {
    log.push(sql);
    if (sql === MIGRATION_TABLES_SQL) state.version = { value: "4" };
  });
  expect(migrateDatabase(d.asDatabase, plan(step(4), step(5))).applied).toEqual([4, 5]);
  expect(log.filter((entry) => entry.startsWith("up"))).toEqual(["up 5"]);
});
test.each<[string, (s: State) => void, string]>([
  ["health is lost", (s) => { s.health = { quick_check: "row 3 missing" }; }, "integrity check failed after migration: row 3 missing"],
  ["a link breaks", (s) => { s.violations = [{ table: "applications", rowid: 9, parent: "jobs", fkid: 0 }]; }, "broke 1 foreign key link(s): applications row 9 -> jobs (fk 0)"],
  ["rows are lost", (s) => { s.counts.jobs = 1; }, "lost rows in jobs: 2 before, 1 after"],
  ["a table disappears", (s) => { s.tables = ["meta"]; }, "lost rows in jobs: 2 before, table removed after"],
])("rejects the run with MigrationIntegrityError when %s and re-enables foreign keys", (_case, damage, message) => {
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, () => damage(state))))).toThrow(MigrationIntegrityError);
  expect(log.at(-1)).toBe("PRAGMA foreign_keys = ON;");
  expect(writes().map((args) => args[0])).toEqual([4]);
  state = { ...state, tables: ["jobs", "meta"], health: { quick_check: "ok" }, violations: [], counts: { jobs: 2, meta: 1 } };
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, () => damage(state))))).toThrow(message);
});
test("tolerates links that were already broken before migrating", () => {
  state.violations = [{ table: "applications", rowid: 1, parent: "jobs", fkid: 0 }];
  expect(migrateDatabase(d.asDatabase, { ...plan(step(4)), clock: undefined }).mode).toBe("migrated");
  expect(writes()[0]).toEqual([4, "step 4", expect.stringMatching(/^\d{4}-\d\d-\d\dT/)]);
});
test("a failing step or verification propagates and still re-enables foreign keys", () => {
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, () => { throw new Error("boom"); })))).toThrow("boom");
  expect(log.at(-1)).toBe("PRAGMA foreign_keys = ON;");
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, undefined, { verify: () => { throw new Error("invariant"); } })))).toThrow("invariant");
  expect(writes().filter(([value]) => value === "4")).toEqual([]);
});
test.each([
  [{ quick_check: "corrupt" }, "integrity check failed before migration: corrupt"],
  [undefined, "integrity check failed before migration: no result"],
])("refuses a damaged workspace before snapshotting or changing it", (health, message) => {
  state.health = health;
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, undefined, { incompatible: true })))).toThrow(message);
  expect(snapshotDatabase).not.toHaveBeenCalled();
  expect(log).toEqual([]);
});
test("a failed snapshot stops before any step runs", () => {
  vi.mocked(snapshotDatabase).mockImplementation(() => { throw new Error("disk full"); });
  expect(() => migrateDatabase(d.asDatabase, plan(step(4, undefined, { incompatible: true })))).toThrow("disk full");
  expect(log).toEqual([]);
});
test.each([
  ["99", "Workspace database schema v99 is newer than this Work Tracker supports (v3)"],
  ["three", 'Unrecognized workspace schema version "three"'],
  ["-1", 'Unrecognized workspace schema version "-1"'],
  [null, 'Unrecognized workspace schema version "null"'],
])("refuses schema version %s without writing", (value, message) => {
  state.version = { value };
  expect(() => migrateDatabase(d.asDatabase, options)).toThrow(IncompatibleSchemaError);
  expect(() => migrateDatabase(d.asDatabase, options)).toThrow(message);
  expect(log).toEqual([]);
  expect(d.transaction).not.toHaveBeenCalled();
});
test.each([
  [[step(2), step(2)], 2, 'Migration "step 2" must have an integer version greater than 2.'],
  [[step(1.5)], 1.5, "integer version greater than 0"],
  [[step(1)], 2, "The last migration (v1) must match the target schema v2."],
  [[], 1, "last migration (v0)"],
])("rejects an invalid migration plan before reading the database", (migrations, target, message) => {
  expect(() => migrateDatabase(d.asDatabase, { ...options, migrations, target })).toThrow(message);
  expect(d.query).not.toHaveBeenCalled();
});
test("the journey step snapshots a v3 workspace, completes its schema, backfills and verifies before stamping the latest schema", () => {
  vi.mocked(snapshotDatabase).mockImplementation((_d, path) => { log.push("snapshot"); return path; });
  vi.mocked(backfillJourney).mockImplementation(() => log.push("backfill"));
  vi.mocked(verifyJourney).mockImplementation(() => log.push("verify"));
  expect(migrateDatabase(d.asDatabase, { backupDir: "/home/backups", clock })).toEqual({
    mode: "migrated", from: 3, to: 13, applied: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13], backup: "/home/backups/work-tracker-v3-to-v13-2026-10-16T12-00-00-000Z.db",
  });
  expect(log).toEqual(["snapshot", "PRAGMA foreign_keys = OFF;", MIGRATION_TABLES_SQL, "ensure", "backfill", "ensure", "ensure", "ensure", "ensure", "ensure", "ensure", "UPDATE jobs SET shortlisted_at = COALESCE(scouted_at, datetime('now')) WHERE shortlisted_at IS NULL", "ensure", "ensure", "ensure", "ensure", "verify", "PRAGMA foreign_keys = ON;"]);
  expect(writes().map((args) => args[0])).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, "13"]);
});
