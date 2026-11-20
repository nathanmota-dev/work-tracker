import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SCHEMA_VERSION } from "../../db/schema.ts";

// Synthetic workspaces only: a source home that is backed up and an isolated
// home that restores it. Modules are reloaded per home because paths are fixed at import.
const root = mkdtempSync(join(tmpdir(), "work-tracker-backup-"));
const previousHome = process.env.WORK_TRACKER_HOME;
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)), Buffer.from("\n%%EOF\n")]);
type Modules = {
  database: typeof import("../../db/index.ts");
  create: typeof import("../../backup/create.ts");
  restore: typeof import("../../backup/restore.ts");
  inspect: typeof import("../../backup/inspect.ts");
  store: typeof import("../../preparation/store.ts");
};
let current: Modules | undefined;
async function workspace(name: string): Promise<Modules & { home: string }> {
  current?.database.closeDb();
  const home = join(root, name);
  process.env.WORK_TRACKER_HOME = home;
  vi.resetModules();
  current = {
    database: await import("../../db/index.ts"),
    create: await import("../../backup/create.ts"),
    restore: await import("../../backup/restore.ts"),
    inspect: await import("../../backup/inspect.ts"),
    store: await import("../../preparation/store.ts"),
  };
  current.database.db();
  return { ...current, home };
}
function seedSource(m: Modules, home: string) {
  const artifacts = join(home, "artifacts", "applications", "12", "run-1");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, "tailored.pdf"), pdf);
  m.database.db().exec(`
    INSERT INTO jobs (id, title, company_name) VALUES (12, 'Data Engineer', 'Example Corp');
    INSERT INTO applications (id, job_id, current_stage_id, tracking_status) VALUES (40, 12, 1, 'active');
    INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, manifest_json, created_at, updated_at)
      VALUES ('run-1', 12, 40, 'completed', 'review', 'fake', '${JSON.stringify({ reportPath: join(artifacts, "report.md"), runId: "run-1" })}', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json)
      VALUES ('pdf-1', 'run-1', 'tailored', '${join(artifacts, "tailored.pdf")}', 1, 'Synthetic resume', '[]');`);
  mkdirSync(join(home, "browsers", "linkedin", "profile"), { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ username: "synthetic-candidate", resumeSources: { projectDir: join(root, "external-latex"), mainFile: "resume.tex", dataFile: "", engine: "pdflatex" } }));
}
const destination = join(root, "destination");
let backup: import("../../backup/format.ts").BackupSummary;
beforeEach(async () => {
  if (backup) return;
  const source = await workspace("source");
  seedSource(source, source.home);
  // Committed rows are still in the WAL: the snapshot must include them.
  expect(statSync(join(source.home, "work-tracker.db-wal")).size).toBeGreaterThan(0);
  mkdirSync(destination);
  backup = source.create.createBackup(destination);
});
afterAll(() => {
  current?.database.closeDb();
  rmSync(root, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});
function tamper(name: string, change: (folder: string) => void): string {
  const folder = join(root, `tampered-${name}`);
  cpSync(backup.path, folder, { recursive: true });
  change(folder);
  return folder;
}
const manifestOf = (folder: string) => JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
const rewrite = (folder: string, edit: (manifest: Record<string, any>) => void) => {
  const manifest = manifestOf(folder);
  edit(manifest);
  writeFileSync(join(folder, "manifest.json"), JSON.stringify(manifest));
};

test("WAL backup is versioned, hashed and lists sources it leaves out", () => {
  expect(readdirSync(destination)).toEqual([backup.path.split("/").at(-1)]);
  const manifest = manifestOf(backup.path);
  expect(manifest).toMatchObject({ format: "work-tracker-backup", formatVersion: 1, schemaVersion: SCHEMA_VERSION, appVersion: "0.0.1" });
  expect(manifest.counts).toMatchObject({ jobs: 1, applications: 1, application_runs: 1, pdf_artifacts: 1 });
  const artifact = manifest.files.find((file: { kind: string }) => file.kind === "artifact");
  expect(artifact).toEqual({ path: "artifacts/applications/12/run-1/tailored.pdf", kind: "artifact", size: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex") });
  expect(manifest.excluded.map((item: { kind: string }) => item.kind)).toEqual(["browser-session", "agent-workspace", "resume-source"]);
  expect(existsSync(join(backup.path, "browsers"))).toBe(false);
  expect(backup).toMatchObject({ artifacts: 1, files: 3, counts: manifest.counts });
});

test("restoring into an isolated workspace recovers records, links and PDF bytes", async () => {
  const target = await workspace("restored");
  target.database.db().exec("INSERT INTO jobs (id, title, company_name) VALUES (99, 'Previous Job', 'Previous Co')");
  const result = target.restore.restoreBackup(backup.path, backup.fingerprint);
  const d = target.database.db();
  expect(d.query("SELECT id, title FROM jobs").all()).toEqual([{ id: 12, title: "Data Engineer" }]);
  expect(d.query("SELECT a.id, r.id AS run, p.id AS pdf FROM applications a JOIN application_runs r ON r.application_id = a.id JOIN pdf_artifacts p ON p.run_id = r.id").all()).toEqual([{ id: 40, run: "run-1", pdf: "pdf-1" }]);
  expect(d.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(target.store.pdfBytes("pdf-1").equals(pdf)).toBe(true);
  expect(target.store.artifactFile("pdf-1").path).toBe(join(target.home, "artifacts", "applications", "12", "run-1", "tailored.pdf"));
  expect(JSON.parse((d.query("SELECT manifest_json FROM application_runs").get() as { manifest_json: string }).manifest_json).reportPath).toContain(target.home);
  expect(JSON.parse(readFileSync(join(target.home, "config.json"), "utf8")).username).toBe("synthetic-candidate");
  expect(result.restored.excluded.some(item => item.kind === "resume-source")).toBe(true);
  // The replaced workspace is kept and readable.
  const { DatabaseSync } = await import("node:sqlite");
  const previous = new DatabaseSync(join(result.previous, "work-tracker.db"), { readOnly: true });
  expect(previous.prepare("SELECT title FROM jobs").all()).toEqual([{ title: "Previous Job" }]);
  previous.close();
  expect(readdirSync(target.home).some(name => name.startsWith(".restore-"))).toBe(false);
});

const damaged: [string, (folder: string) => void, string][] = [
  ["corrupted manifest", folder => writeFileSync(join(folder, "manifest.json"), "{ not json"), "corrupted"],
  ["incompatible format", folder => rewrite(folder, m => { m.formatVersion = 2; }), "Backup format v2 is not supported"],
  ["newer schema", folder => rewrite(folder, m => { m.schemaVersion = 99; }), "newer than this Work Tracker supports"],
  ["divergent hash", folder => writeFileSync(join(folder, "artifacts/applications/12/run-1/tailored.pdf"), Buffer.from("%PDF-tampered")), "does not match its recorded hash"],
  ["path outside the backup", folder => rewrite(folder, m => { m.files[2].path = "artifacts/../../escape.pdf"; }), "outside the backup folder"],
  ["link outside the backup", folder => {
    writeFileSync(join(root, "outside.pdf"), pdf);
    rmSync(join(folder, "artifacts/applications/12/run-1/tailored.pdf"));
    symlinkSync(join(root, "outside.pdf"), join(folder, "artifacts/applications/12/run-1/tailored.pdf"));
  }, "links outside its folder"],
  ["damaged database", folder => {
    const path = join(folder, "database/work-tracker.db");
    const bytes = readFileSync(path);
    bytes.fill(0x41, 1024, 4096);
    writeFileSync(path, bytes);
    rewrite(folder, m => { m.files[0].sha256 = createHash("sha256").update(bytes).digest("hex"); });
  }, "integrity check"],
];
test.each(damaged)("%s is detected before any data is replaced", async (name, change, message) => {
  const folder = tamper(name.replaceAll(" ", "-"), change);
  const target = await workspace(`guarded-${name.replaceAll(" ", "-")}`);
  target.database.db().exec("INSERT INTO jobs (id, title) VALUES (7, 'Kept Job')");
  expect(() => target.inspect.inspectBackup(folder)).toThrow(message);
  expect(() => target.restore.restoreBackup(folder, backup.fingerprint)).toThrow(message);
  expect(target.database.db().query("SELECT title FROM jobs").all()).toEqual([{ title: "Kept Job" }]);
  expect(readdirSync(target.home).filter(name => name.startsWith(".restore-") || name === "backups")).toEqual([]);
});

test("a failure during restore rolls back to the previous workspace", async () => {
  const target = await workspace("rollback");
  target.database.db().exec("INSERT INTO jobs (id, title) VALUES (8, 'Original Job')");
  mkdirSync(join(target.home, "artifacts", "mine"), { recursive: true });
  writeFileSync(join(target.home, "artifacts", "mine", "kept.pdf"), "original artifact");
  writeFileSync(join(target.home, "config.json"), '{"username":"original"}');
  expect(() => target.restore.restoreBackup(backup.path, backup.fingerprint, { beforeOpen: () => { throw new Error("disk full"); } }))
    .toThrow("Restore failed and your previous workspace was kept: disk full");
  expect(target.database.db().query("SELECT title FROM jobs").all()).toEqual([{ title: "Original Job" }]);
  expect(readFileSync(join(target.home, "artifacts", "mine", "kept.pdf"), "utf8")).toBe("original artifact");
  expect(readFileSync(join(target.home, "config.json"), "utf8")).toBe('{"username":"original"}');
  expect(existsSync(join(target.home, "artifacts", "applications"))).toBe(false);
  expect(readdirSync(join(target.home, "backups"))).toEqual([]);
  expect(readdirSync(target.home).some(name => name.startsWith(".restore-"))).toBe(false);
});

test("a backup changed after review is refused", async () => {
  const target = await workspace("stale");
  expect(() => target.restore.restoreBackup(backup.path, "0".repeat(64))).toThrow("changed after it was reviewed");
});
