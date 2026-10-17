import { Database } from "./sqlite.ts";
import { ensureHome, paths } from "../paths.ts";
import { migrateDatabase } from "./migrations.ts";

let _db: Database | null = null;

/**
 * Open (and memoize) the Work Tracker database, creating a new schema or
 * running pending versioned migrations. Refuses newer or unknown versions.
 * WAL mode so the dashboard can read while the CLI writes.
 */
export function db(): Database {
  if (_db) return _db;
  ensureHome();
  const d = new Database(paths.db, { create: true });
  try {
    d.exec("PRAGMA journal_mode = WAL;");
    d.exec("PRAGMA foreign_keys = ON;");
    d.exec("PRAGMA busy_timeout = 5000;");
    migrateDatabase(d, { backupDir: paths.backups });
  } catch (error) { d.close(); throw error; }
  _db = d;
  return d;
}

/** ISO timestamp helper used across write commands. */
export function now(): string {
  return new Date().toISOString();
}

export function closeDb(): void { _db?.close(); _db = null; }
