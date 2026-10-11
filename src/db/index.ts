import { Database } from "./sqlite.ts";
import { ensureHome, paths } from "../paths.ts";
import { SCHEMA_SQL, SCHEMA_VERSION, COLUMN_MIGRATIONS, APPLICATION_BOARD_INDEX_SQL, DEFAULT_APPLICATION_STAGES } from "./schema.ts";

let _db: Database | null = null;

/** Add any columns declared in COLUMN_MIGRATIONS that don't yet exist. */
function applyColumnMigrations(d: Database): void {
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    const existing = new Set(
      (d.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    for (const [col, type] of Object.entries(columns)) {
      if (!existing.has(col)) {
        d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    }
  }
}

/** Seed the singleton outreach_budget row (id=1) if it doesn't exist yet. */
function seedOutreachBudget(d: Database): void {
  const exists = d.query("SELECT 1 FROM outreach_budget WHERE id = 1").get();
  if (exists) return;
  d.exec(
    `INSERT INTO outreach_budget (id, plan, inmail_monthly_allotment,
       inmail_rollover_cap, cycle_reset_day, credits_remaining,
       credits_used_this_cycle, reserve_floor)
     VALUES (1, 'none', 0, 0, 1, 0, 0, 0)`,
  );
}

/**
 * Open (and memoize) the Work Tracker database, applying schema idempotently.
 * WAL mode so the dashboard can read while the CLI writes.
 */
export function db(): Database {
  if (_db) return _db;
  ensureHome();
  const d = new Database(paths.db, { create: true });
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec("PRAGMA busy_timeout = 5000;");
  try {
    d.transaction(() => {
      d.exec(SCHEMA_SQL);
      applyColumnMigrations(d);
      d.exec(APPLICATION_BOARD_INDEX_SQL);
      DEFAULT_APPLICATION_STAGES.forEach((stage, position) => {
        d.query(`INSERT INTO application_stages (key, name, category, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`)
          .run(stage.key, stage.name, stage.category, position, now(), now());
      });
      seedOutreachBudget(d);
      d.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    })();
  } catch (error) { d.close(); throw error; }
  _db = d;
  return d;
}

/** ISO timestamp helper used across write commands. */
export function now(): string {
  return new Date().toISOString();
}

export function closeDb(): void { _db?.close(); _db = null; }
