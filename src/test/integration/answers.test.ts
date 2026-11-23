import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { SCHEMA_VERSION } from "../../db/schema.ts";
import { MIGRATIONS, migrateDatabase } from "../../db/migrations.ts";
import { saveAnswer, deleteAnswer, listAnswerVariants } from "../../answers/store.ts";
import { resolveAnswer } from "../../answers/catalog.ts";
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "work-tracker-answers-")); homes.push(home);
  const d = new Database(join(home, "answers.db"));
  const options = { backupDir: join(home, "backups") };
  migrateDatabase(d, { ...options, migrations: MIGRATIONS.filter(step => step.version <= 5), target: 5 });
  d.exec("DROP TABLE applicant_answer_variants; PRAGMA foreign_keys = ON;");
  return { d, options };
}
test("migrates legacy answers unchanged, preserves canonical keys and persists version CRUD", () => {
  const { d, options } = fixture();
  try {
    d.exec(`INSERT INTO applicant_answers VALUES ('email', 'fixture@example.test', 'contact', 'legacy-time'),
      ('custom_key', 'Legacy text', 'custom', 'legacy-time'), ('notice_period', 'Two weeks', 'eligibility', 'legacy-time')`);
    const legacy = d.query("SELECT * FROM applicant_answers ORDER BY key").all();
    expect(migrateDatabase(d, options)).toMatchObject({ from: 5, to: SCHEMA_VERSION, applied: [6, 7, 8, 9, 10, 11, 12, 13] });
    expect(d.query("SELECT * FROM applicant_answers ORDER BY key").all()).toEqual(legacy);
    saveAnswer({ key: "notice_period", value: "Duas semanas", language: "pt-br" }, d);
    expect(resolveAnswer(listAnswerVariants(d), "notice_period", "pt-BR")).toMatchObject({ value: "Duas semanas", fallback: false });
    expect(resolveAnswer(listAnswerVariants(d), "notice_period", "en")).toMatchObject({ status: "missing" });
    expect(resolveAnswer(listAnswerVariants(d), "notice_period", "en", "default")).toMatchObject({ value: "Two weeks", fallback: true });
    saveAnswer({ key: "notice_period", value: "Três semanas", language: "pt-BR" }, d);
    expect(resolveAnswer(listAnswerVariants(d), "notice_period", "pt-BR").value).toBe("Três semanas");
    deleteAnswer({ key: "notice_period", language: "pt-BR" }, d);
    expect(resolveAnswer(listAnswerVariants(d), "notice_period").value).toBe("Two weeks");
    saveAnswer({ key: "notice_period", value: "Four weeks", language: "en" }, d);
    deleteAnswer({ key: "notice_period" }, d);
    expect(resolveAnswer(listAnswerVariants(d), "notice_period").status).toBe("missing");
    expect(resolveAnswer(listAnswerVariants(d), "notice_period", "en").value).toBe("Four weeks");
    deleteAnswer({ key: "notice_period", language: "en" }, d);
    expect(d.query("SELECT * FROM applicant_answers WHERE key = 'notice_period'").get()).toBeUndefined();
    deleteAnswer({ key: "custom_key" }, d);
    expect(d.query("SELECT value FROM applicant_answers WHERE key = 'email'").get()).toMatchObject({ value: "fixture@example.test" });
    expect(migrateDatabase(d, options).applied).toEqual([]);
  } finally { d.close(); }
});
test("validation and injected SQLite failures preserve every previous answer atomically", () => {
  const { d, options } = fixture();
  try {
    migrateDatabase(d, options);
    saveAnswer({ key: "notice_period", value: "Two weeks" }, d);
    const before = listAnswerVariants(d);
    expect(() => saveAnswer({ key: "email", value: "invalid" }, d)).toThrow("valid email");
    d.exec(`CREATE TRIGGER fail_variant BEFORE INSERT ON applicant_answer_variants BEGIN SELECT RAISE(ABORT, 'fixture failure'); END`);
    expect(() => saveAnswer({ key: "notice_period", value: "Duas semanas", language: "pt" }, d)).toThrow("fixture failure");
    expect(() => saveAnswer({ key: "new_key", value: "New text", language: "pt" }, d)).toThrow("fixture failure");
    expect(listAnswerVariants(d)).toEqual(before);
    d.exec("DROP TRIGGER fail_variant");
    saveAnswer({ key: "notice_period", value: "Duas semanas", language: "pt" }, d);
    d.exec(`CREATE TRIGGER fail_delete BEFORE DELETE ON applicant_answer_variants BEGIN SELECT RAISE(ABORT, 'delete failure'); END`);
    const updated = listAnswerVariants(d);
    expect(() => deleteAnswer({ key: "notice_period", language: "pt" }, d)).toThrow("delete failure");
    expect(listAnswerVariants(d)).toEqual(updated);
  } finally { d.close(); }
});
