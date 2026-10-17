import { vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Database } from "../db/sqlite.ts";
import { ensureCurrentSchema } from "../db/current-schema.ts";

/**
 * An explicitly configured in-memory SQLite database with the latest schema,
 * for unit tests of SQL rules. Nothing touches the file system; the unit setup
 * keeps blocking every other SQLite use.
 */
export async function memoryDatabase(): Promise<Database> {
  const real = await vi.importActual<typeof import("node:sqlite")>("node:sqlite");
  vi.mocked(DatabaseSync).mockImplementationOnce(function () {
    return new real.DatabaseSync(":memory:");
  });
  const d = new Database(":memory:");
  d.transaction(() => ensureCurrentSchema(d))();
  return d;
}

function insertRow(d: Database, table: string, values: Record<string, string | number | null>): number {
  const columns = Object.keys(values);
  return (d.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`)
    .get(...Object.values(values)) as { id: number }).id;
}

/** Insert one job and return its local ID. */
export function insertJob(d: Database, fields: Record<string, string | null> = {}): number {
  return insertRow(d, "jobs", { title: "Engineer", company_name: "Example Corp", link: "https://jobs.example.test/role", ...fields });
}

/**
 * Insert one application row as stored (legacy or current) and return its ID.
 * Links are not enforced, so a legacy row may point at a deleted job.
 */
export function insertApplication(d: Database, fields: Record<string, string | number | null> = {}): number {
  d.exec("PRAGMA foreign_keys = OFF");
  return insertRow(d, "applications", { status: "draft", attempt: 1, ...fields });
}
