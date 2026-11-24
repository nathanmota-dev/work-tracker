import type { Database } from "./sqlite.ts";
import { SCHEMA_SQL, COLUMN_MIGRATIONS, APPLICATION_BOARD_INDEX_SQL, DEFAULT_APPLICATION_STAGES } from "./schema.ts";
import { DEADLINE_COLUMNS } from "./deadline-schema.ts";
import { POSTING_GUARD_COLUMNS } from "./posting-guard-schema.ts";
import { GATE_COLUMNS } from "./gate-schema.ts";
import { VARIANT_COLUMNS } from "./variant-schema.ts";

/** Every additive column migration, including the ones feature modules keep apart. */
export const ALL_COLUMN_MIGRATIONS: Record<string, Record<string, string>>[] = [COLUMN_MIGRATIONS, DEADLINE_COLUMNS, POSTING_GUARD_COLUMNS, GATE_COLUMNS, VARIANT_COLUMNS];

/** Add any declared columns that don't yet exist. */
function applyColumnMigrations(d: Database): void {
  for (const [table, columns] of ALL_COLUMN_MIGRATIONS.flatMap((migrations) => Object.entries(migrations))) {
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
 * Create missing tables, columns, indexes and seed rows of the latest schema.
 * Only additive and idempotent: existing rows, IDs and columns are never changed.
 * Must run inside the caller's transaction.
 */
export function ensureCurrentSchema(d: Database): void {
  d.exec(SCHEMA_SQL);
  applyColumnMigrations(d);
  d.exec(APPLICATION_BOARD_INDEX_SQL);
  const at = new Date().toISOString();
  DEFAULT_APPLICATION_STAGES.forEach((stage, position) => {
    d.query(`INSERT INTO application_stages (key, name, category, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO NOTHING`)
      .run(stage.key, stage.name, stage.category, position, at, at);
  });
  seedOutreachBudget(d);
}
