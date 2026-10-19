import { join } from "node:path";
import type { Database } from "./sqlite.ts";
import { MIGRATION_TABLES_SQL, SCHEMA_VERSION } from "./schema.ts";
import { ensureCurrentSchema } from "./current-schema.ts";
import { snapshotDatabase } from "./snapshot.ts";
import { backfillJourney, verifyJourney } from "./journey-backfill.ts";

/**
 * One explicit step in the schema history.
 *
 * @property version Strictly increasing schema version reached after `up`.
 * @property incompatible True when `up` rewrites or removes existing structure or
 *   data; a consistent snapshot of the workspace is written before it runs.
 * @property up Synchronous transformation. Runs inside the migration transaction
 *   with foreign-key enforcement off, so tables can be rebuilt; links are
 *   verified with `foreign_key_check` before commit.
 * @property [verify] Extra invariant checked after every pending step, before commit.
 */
export interface Migration {
  version: number;
  name: string;
  incompatible?: boolean;
  up(d: Database): void;
  verify?(d: Database): void;
}

/** The workspace was written by a newer or unknown schema and must not be opened. */
export class IncompatibleSchemaError extends Error {
  override name = "IncompatibleSchemaError";
}

/** A migration broke links, lost rows or left a damaged database; it was rolled back. */
export class MigrationIntegrityError extends Error {
  override name = "MigrationIntegrityError";
}

/**
 * Ordered schema history. Append new steps with the next version and bump
 * SCHEMA_VERSION; never edit or reorder a released step. SCHEMA_SQL must keep
 * describing the latest schema because new databases are created from it.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 3,
    name: "legacy additive baseline",
    // Workspaces stamped 0-3 were kept current by additive changes only; this
    // creates whatever tables, columns and seed rows they are still missing.
    up: ensureCurrentSchema,
  },
  {
    version: 4,
    name: "application journey model",
    // Rewrites the legacy status summary of board records, so take a snapshot.
    incompatible: true,
    up: (d) => {
      ensureCurrentSchema(d);
      backfillJourney(d);
    },
    verify: verifyJourney,
  },
  { version: 5, name: "external job identity", up: ensureCurrentSchema },
  { version: 6, name: "reusable answer languages", up: ensureCurrentSchema },
  { version: 7, name: "document review versions", up: ensureCurrentSchema },
];

/**
 * @property backupDir Directory for snapshots taken before incompatible steps.
 * @property [migrations] Schema history; defaults to MIGRATIONS.
 * @property [target] Version to reach; defaults to SCHEMA_VERSION.
 * @property [clock] Time source for history rows and snapshot names.
 */
export interface MigrationOptions {
  backupDir: string;
  migrations?: readonly Migration[];
  target?: number;
  clock?: () => Date;
}

/**
 * @property mode `created` for an empty database, `migrated` when steps ran,
 *   `current` when only additive compatible changes were applied.
 * @property from Version found on open; null for an empty database.
 * @property backup Snapshot path when an incompatible step ran, otherwise null.
 */
export interface MigrationResult {
  mode: "created" | "migrated" | "current";
  from: number | null;
  to: number;
  applied: number[];
  backup: string | null;
}

/**
 * Bring an open database to `target`. New databases get the latest schema
 * directly; existing workspaces run their pending steps in version order inside
 * one transaction that also records each step and, last, the new version, so a
 * failure leaves the version, history and data unchanged.
 */
export function migrateDatabase(d: Database, options: MigrationOptions): MigrationResult {
  const { migrations = MIGRATIONS, target = SCHEMA_VERSION, clock = () => new Date() } = options;
  assertMigrationPlan(migrations, target);
  const from = readVersion(d);
  if (from !== null && from > target)
    throw new IncompatibleSchemaError(
      `Workspace database schema v${from} is newer than this Work Tracker supports (v${target}). Update Work Tracker; the database was not modified.`,
    );
  if (from === null) {
    d.transaction(() => {
      ensureCurrentSchema(d);
      const at = clock().toISOString();
      for (const migration of migrations) recordMigration(d, migration, at);
      writeVersion(d, target);
    })();
    return { mode: "created", from, to: target, applied: [], backup: null };
  }
  const pending = migrations.filter((migration) => migration.version > from);
  if (!pending.length) {
    d.transaction(() => ensureCurrentSchema(d))();
    return { mode: "current", from, to: target, applied: [], backup: null };
  }
  return upgrade(d, from, target, pending, options.backupDir, clock);
}

function upgrade(
  d: Database,
  from: number,
  target: number,
  pending: readonly Migration[],
  backupDir: string,
  clock: () => Date,
): MigrationResult {
  assertHealthy(d, "before migration");
  const linksBefore = foreignKeyViolations(d);
  const rowsBefore = rowCounts(d);
  const backup = pending.some((migration) => migration.incompatible)
    ? snapshotDatabase(d, join(backupDir, backupName(from, target, clock())))
    : null;
  d.exec("PRAGMA foreign_keys = OFF;");
  try {
    d.transaction(() => {
      d.exec(MIGRATION_TABLES_SQL);
      // Another process may have migrated between the first read and the write lock.
      const current = readVersion(d) ?? 0;
      const at = clock().toISOString();
      for (const migration of pending.filter((step) => step.version > current)) {
        migration.up(d);
        recordMigration(d, migration, at);
      }
      ensureCurrentSchema(d);
      for (const migration of pending) migration.verify?.(d);
      assertHealthy(d, "after migration");
      assertLinksKept(linksBefore, foreignKeyViolations(d));
      assertRowsKept(rowsBefore, rowCounts(d));
      writeVersion(d, target);
    })();
  } finally {
    d.exec("PRAGMA foreign_keys = ON;");
  }
  return { mode: "migrated", from, to: target, applied: pending.map((migration) => migration.version), backup };
}

function assertMigrationPlan(migrations: readonly Migration[], target: number): void {
  migrations.forEach((migration, index) => {
    const previous = index ? migrations[index - 1]!.version : 0;
    if (!Number.isSafeInteger(migration.version) || migration.version <= previous)
      throw new Error(`Migration "${migration.name}" must have an integer version greater than ${previous}.`);
  });
  const last = migrations.at(-1)?.version ?? 0;
  if (last !== target) throw new Error(`The last migration (v${last}) must match the target schema v${target}.`);
}

/** Null for an empty database; 0 for a legacy workspace that never stamped a version. */
export function readVersion(d: Database): number | null {
  const tables = userTables(d);
  if (!tables.length) return null;
  if (!tables.includes("meta")) return 0;
  const row = d.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string | null } | undefined;
  if (!row) return 0;
  const version = Number(row.value);
  if (row.value === null || !Number.isSafeInteger(version) || version < 0)
    throw new IncompatibleSchemaError(`Unrecognized workspace schema version "${row.value}"; the database was not modified.`);
  return version;
}

function writeVersion(d: Database, version: number): void {
  d.query(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(version));
}

function recordMigration(d: Database, migration: Migration, at: string): void {
  d.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?) ON CONFLICT(version) DO NOTHING")
    .run(migration.version, migration.name, at);
}

function userTables(d: Database): string[] {
  return (d.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((table) => table.name);
}

function assertHealthy(d: Database, stage: string): void {
  const result = d.query("PRAGMA quick_check").get() as { quick_check: string } | undefined;
  if (result?.quick_check !== "ok")
    throw new MigrationIntegrityError(`Database integrity check failed ${stage}: ${result?.quick_check ?? "no result"}`);
}

function foreignKeyViolations(d: Database): Set<string> {
  const rows = d.query("PRAGMA foreign_key_check").all() as { table: string; rowid: number | null; parent: string; fkid: number }[];
  return new Set(rows.map((row) => `${row.table} row ${row.rowid} -> ${row.parent} (fk ${row.fkid})`));
}

export function rowCounts(d: Database): Map<string, number> {
  return new Map(userTables(d).map((table) => {
    const row = d.query(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"', '""')}"`).get() as { n: number };
    return [table, Number(row.n)];
  }));
}

/** Pre-existing broken links are tolerated; a migration must not add new ones. */
function assertLinksKept(before: Set<string>, after: Set<string>): void {
  const broken = [...after].filter((violation) => !before.has(violation));
  if (broken.length)
    throw new MigrationIntegrityError(`Migration broke ${broken.length} foreign key link(s): ${broken.slice(0, 5).join("; ")}`);
}

function assertRowsKept(before: Map<string, number>, after: Map<string, number>): void {
  for (const [table, count] of before) {
    const remaining = after.get(table);
    if (remaining === undefined || remaining < count)
      throw new MigrationIntegrityError(`Migration lost rows in ${table}: ${count} before, ${remaining ?? "table removed"} after.`);
  }
}

function backupName(from: number, target: number, at: Date): string {
  return `work-tracker-v${from}-to-v${target}-${at.toISOString().replace(/[:.]/g, "-")}.db`;
}
