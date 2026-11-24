import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { MIGRATIONS, migrateDatabase } from "../../db/migrations.ts";
import { SCHEMA_VERSION } from "../../db/schema.ts";

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

test("upgrading the answer catalog's v6 keeps localized answers and submitted PDF references", () => {
  const home = mkdtempSync(join(tmpdir(), "work-tracker-document-migration-"));
  homes.push(home);
  const d = new Database(join(home, "workspace.db"));
  const options = { backupDir: join(home, "backups") };
  const preservedTables = ["applicant_answers", "applicant_answer_variants", "jobs", "applications", "application_runs", "pdf_artifacts"];
  const snapshot = () => Object.fromEntries(preservedTables.map(table => [table, d.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  try {
    migrateDatabase(d, { ...options, migrations: MIGRATIONS.filter(step => step.version <= 6), target: 6 });
    // ensureCurrentSchema is additive; remove the future tables to model released v6 exactly.
    d.exec(`DROP TABLE application_documents; DROP TABLE document_versions;
      INSERT INTO applicant_answers (key, value, category) VALUES ('notice_period', 'Two weeks', 'eligibility');
      INSERT INTO applicant_answer_variants (key, language, value, updated_at) VALUES ('notice_period', 'pt-BR', 'Duas semanas', 'fixture-time');
      INSERT INTO jobs (id, title, company_name, description) VALUES (1, 'Engineer', 'Example', 'Generic role');
      INSERT INTO applications (id, job_id, status, preparation_status, fill_status, submission_status, submitted_at, resume_path)
        VALUES (1, 1, 'submitted', 'ready', 'filled', 'submitted', 'fixture-time', '/fixture/resume.pdf');
      INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at)
        VALUES ('run-1', 1, 1, 'completed', 'review', 'fixture', 'fixture-time', 'fixture-time');
      INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json)
        VALUES ('pdf-1', 'run-1', 'tailored', '/fixture/resume.pdf', 1, 'Synthetic resume', '[]');
      UPDATE applications SET preparation_run_id = 'run-1' WHERE id = 1;`);
    const before = snapshot();
    before.jobs = before.jobs!.map(row => ({ ...(row as object), shortlisted_at: expect.any(String) }));
    expect(migrateDatabase(d, options)).toMatchObject({ from: 6, to: SCHEMA_VERSION, applied: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], backup: expect.any(String) });
    expect(snapshot()).toEqual(before);
    expect(d.query("SELECT version, name FROM schema_migrations WHERE version >= 6 ORDER BY version").all()).toEqual([
      { version: 6, name: "reusable answer languages" },
      { version: 7, name: "document review versions" },
      { version: 8, name: "preparation batch queue" },
      { version: 9, name: "idempotent batch requests" },
      { version: 10, name: "job triage" },
      { version: 11, name: "onboarding preferences" },
      { version: 12, name: "interview preparation packs" },
      { version: 13, name: "application deadlines" },
      { version: 14, name: "posting integrity guard" },
      { version: 15, name: "company research cache" },
      { version: 16, name: "follow-up drafts" },
      { version: 17, name: "job rankings" },
      { version: 18, name: "requirement gates" },
      { version: 19, name: "profile sources" },
    ]);
    expect(d.query("SELECT * FROM document_versions").all()).toEqual([]);
    expect(d.query("SELECT * FROM application_documents").all()).toEqual([]);
    expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(migrateDatabase(d, options).applied).toEqual([]);
    expect(snapshot()).toEqual(before);
  } finally { d.close(); }
});
