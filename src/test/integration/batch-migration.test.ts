import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { MIGRATIONS, migrateDatabase } from "../../db/migrations.ts";

test("upgrading a v7 workspace adds empty batch tables without changing runs or applications", () => {
  const home = mkdtempSync(join(tmpdir(), "work-tracker-batch-migration-"));
  const d = new Database(join(home, "workspace.db"));
  const options = { backupDir: join(home, "backups") };
  const snapshot = () => Object.fromEntries(["jobs", "applications", "application_runs", "document_versions"].map(table => [table, d.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  try {
    migrateDatabase(d, { ...options, migrations: MIGRATIONS.filter(step => step.version <= 7), target: 7 });
    // ensureCurrentSchema is additive; remove the future tables to model released v7 exactly.
    d.exec(`DROP TABLE preparation_batch_requests; DROP TABLE preparation_batch_items; DROP TABLE preparation_batches;
      INSERT INTO jobs (id, title, company_name, description) VALUES (1, 'Engineer', 'Example', 'Generic role');
      INSERT INTO applications (id, job_id, status, preparation_status) VALUES (1, 1, 'draft', 'ready');
      INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at)
        VALUES ('run-1', 1, 1, 'interrupted', 'tailoring', 'fixture', 'fixture-time', 'fixture-time');`);
    const before = snapshot();
    before.jobs = before.jobs!.map(row => ({ ...(row as object), shortlisted_at: expect.any(String) }));
    expect(migrateDatabase(d, options)).toMatchObject({ from: 7, to: 17, applied: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], backup: expect.any(String) });
    expect(snapshot()).toEqual(before);
    expect(d.query("SELECT COUNT(*) AS n FROM preparation_batches").get()).toEqual({ n: 0 });
    d.exec("INSERT INTO preparation_batches (id, status, provider, source_version, sources_json, created_at, updated_at) VALUES ('b', 'active', 'fixture', 'v', '{}', 'now', 'now')");
    d.exec("INSERT INTO preparation_batch_items (id, batch_id, position, job_id, run_id, phase, status, created_at, updated_at) VALUES ('i', 'b', 1, 1, 'run-1', 'tailoring', 'interrupted', 'now', 'now')");
    expect(() => d.exec("INSERT INTO preparation_batch_items (id, batch_id, position, job_id, phase, status, created_at, updated_at) VALUES ('j', 'b', 1, 1, 'queued', 'pending', 'now', 'now')")).toThrow(/UNIQUE/);
    expect(() => d.exec("INSERT INTO preparation_batch_items (id, batch_id, position, job_id, phase, status, created_at, updated_at) VALUES ('k', 'b', 2, 1, 'unknown', 'pending', 'now', 'now')")).toThrow(/CHECK/);
    expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrateDatabase(d, options).applied).toEqual([]);
  } finally { d.close(); rmSync(home, { recursive: true, force: true }); }
});
