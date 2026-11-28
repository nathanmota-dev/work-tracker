import { afterAll, beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../db/schema.ts";

// Backup and restore are file-system protocols, so these tests opt in to real
// I/O, confined to a private temporary folder, instead of the guarded doubles.
const real = await vi.importActual<typeof import("node:fs")>("node:fs");
const sqlite = await vi.importActual<typeof import("node:sqlite")>("node:sqlite");
const root = real.mkdtempSync(join(tmpdir(), "work-tracker-backup-unit-"));
const guarded = ["existsSync", "mkdirSync", "readFileSync", "writeFileSync", "unlinkSync", "cpSync", "readdirSync", "rmSync", "accessSync"] as const;
beforeEach(() => {
  for (const name of guarded) vi.mocked(fs[name]).mockImplementation(real[name] as never);
  vi.mocked(DatabaseSync).mockImplementation(function (path: string, options?: object) {
    return new sqlite.DatabaseSync(path, options ?? {});
  } as never);
});
afterAll(() => real.rmSync(root, { recursive: true, force: true }));

type Workspace = Awaited<ReturnType<typeof open>>;
let count = 0;
async function open(name = `home-${++count}`) {
  const home = join(root, name);
  vi.stubEnv("WORK_TRACKER_HOME", home);
  vi.resetModules();
  const database = await import("../db/index.ts");
  database.db();
  const modules = { database, create: await import("./create.ts"), inspect: await import("./inspect.ts"), restore: await import("./restore.ts") };
  return { home, ...modules, close: database.closeDb, sql: (text: string) => database.db().exec(text), rows: (text: string) => database.db().query(text).all() };
}
function folder(name: string): string {
  const path = join(root, name);
  real.mkdirSync(path, { recursive: true });
  return path;
}
function seed(w: Workspace) {
  const artifacts = join(w.home, "artifacts", "applications", "1");
  real.mkdirSync(artifacts, { recursive: true });
  real.writeFileSync(join(artifacts, "resume.pdf"), "%PDF-synthetic");
  real.symlinkSync(join(artifacts, "resume.pdf"), join(artifacts, "linked.pdf"));
  execFileSync("mkfifo", [join(artifacts, "pipe")]);
  real.mkdirSync(join(w.home, "browsers"));
  real.writeFileSync(join(w.home, "config.json"), JSON.stringify({ username: "synthetic" }));
  real.mkdirSync(join(w.home, "profile"));
  w.sql(`INSERT INTO jobs (id, title) VALUES (1, 'Engineer');
    INSERT INTO application_runs (id, job_id, status, phase, provider, manifest_json, created_at, updated_at) VALUES
      ('run', 1, 'completed', 'review', 'fake', '${JSON.stringify({ reportPath: join(artifacts, "report.md"), nested: { project: join(artifacts, "project") }, attempt: 1 })}', 'now', 'now'),
      ('broken', 1, 'completed', 'review', 'fake', 'not json', 'now', 'now');
    INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES
      ('inside', 'run', 'tailored', '${join(artifacts, "resume.pdf")}', 1, '', '[]'),
      ('outside', 'run', 'base', '/elsewhere/base.pdf', 1, '', '[]');`);
}
const manifestOf = (path: string) => JSON.parse(real.readFileSync(join(path, "manifest.json"), "utf8"));
function copyWith(source: string, edit: (path: string) => void): string {
  const target = join(root, `copy-${++count}`);
  real.cpSync(source, target, { recursive: true });
  edit(target);
  return target;
}
function rewrite(path: string, edit: (manifest: Record<string, any>) => void) {
  const manifest = manifestOf(path);
  edit(manifest);
  real.writeFileSync(join(path, "manifest.json"), JSON.stringify(manifest));
}

let backup: import("./format.ts").BackupSummary;
let source: Workspace;
beforeEach(async () => {
  if (backup) return;
  source = await open("source");
  seed(source);
  backup = source.create.createBackup(`${folder("out")}/`);
  source.close();
});

test("backs up the database, config and regular artifacts, reporting what it leaves out", () => {
  const manifest = manifestOf(backup.path);
  expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(["database/work-tracker.db", "config/config.json", "artifacts/applications/1/resume.pdf"]);
  expect(manifest.excluded.map((item: { kind: string }) => item.kind)).toEqual(["browser-session", "agent-workspace", "resume-source", "symlink"]);
  expect(manifest.counts).toMatchObject({ jobs: 1, application_runs: 2, pdf_artifacts: 2 });
  expect(backup).toMatchObject({ schemaVersion: SCHEMA_VERSION, files: 3, artifacts: 1 });
  expect(real.readdirSync(join(root, "out"))).toEqual([backup.path.split("/").at(-1)]);
});

test("restores into another workspace and rebases stored artifact paths", async () => {
  const target = await open();
  const result = target.restore.restoreBackup(backup.path, backup.fingerprint);
  expect(result.restored.fingerprint).toBe(backup.fingerprint);
  expect(target.rows("SELECT id, path FROM pdf_artifacts ORDER BY id")).toEqual([
    { id: "inside", path: join(target.home, "artifacts", "applications", "1", "resume.pdf") },
    { id: "outside", path: "/elsewhere/base.pdf" },
  ]);
  const runs = target.rows("SELECT id, manifest_json FROM application_runs ORDER BY id") as { manifest_json: string }[];
  expect(runs[0]!.manifest_json).toBe("not json");
  expect(JSON.parse(runs[1]!.manifest_json)).toEqual({ reportPath: join(target.home, "artifacts", "applications", "1", "report.md"), nested: { project: join(target.home, "artifacts", "applications", "1", "project") }, attempt: 1 });
  expect(real.readFileSync(join(target.home, "artifacts", "applications", "1", "resume.pdf"), "utf8")).toBe("%PDF-synthetic");
  expect(real.existsSync(join(result.previous, "work-tracker.db"))).toBe(true);
  target.close();
});

test("a workspace without config or artifacts backs up and restores with defaults", async () => {
  const empty = await open();
  real.rmSync(join(empty.home, "config.json"));
  real.rmSync(join(empty.home, "artifacts"), { recursive: true });
  const summary = empty.create.createBackup(folder("empty-out"));
  expect(summary).toMatchObject({ files: 1, artifacts: 0 });
  empty.restore.restoreBackup(summary.path, summary.fingerprint);
  expect(real.readFileSync(join(empty.home, "config.json"), "utf8")).toBe("{}\n");
  expect(real.readdirSync(join(empty.home, "artifacts"))).toEqual([]);
  empty.close();
});

test("rejects unusable destinations and never leaves a partial backup", async () => {
  const w = await open();
  real.writeFileSync(join(root, "a-file"), "");
  expect(() => w.create.createBackup(42)).toThrow("absolute destination");
  expect(() => w.create.createBackup("relative")).toThrow("absolute destination");
  expect(() => w.create.createBackup(join(root, "missing"))).toThrow("does not exist");
  expect(() => w.create.createBackup(join(root, "a-file"))).toThrow("does not exist");
  expect(() => w.create.createBackup(join(w.home, "artifacts"))).toThrow("outside the workspace artifact folder");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
  const out = folder("same-second");
  w.create.createBackup(out);
  expect(() => w.create.createBackup(out)).toThrow("already exists");
  vi.useRealTimers();
  real.rmSync(join(w.home, "config.json"));
  real.mkdirSync(join(w.home, "config.json"));
  const failing = folder("failing");
  expect(() => w.create.createBackup(failing)).toThrow();
  expect(real.readdirSync(failing)).toEqual([]);
  w.close();
});

test.each([
  ["a missing manifest", (path: string) => real.rmSync(join(path, "manifest.json")), "missing manifest.json"],
  ["a manifest that is a folder", (path: string) => { real.rmSync(join(path, "manifest.json")); real.mkdirSync(join(path, "manifest.json")); }, "not a regular file"],
  ["an oversized manifest", (path: string) => real.truncateSync(join(path, "manifest.json"), 17 * 1024 * 1024), "too large"],
  ["a resized file", (path: string) => real.writeFileSync(join(path, "artifacts/applications/1/resume.pdf"), "%PDF-other-size"), "recorded hash"],
  ["a same-size edit", (path: string) => real.writeFileSync(join(path, "artifacts/applications/1/resume.pdf"), "%PDF-SYNTHETIC"), "recorded hash"],
  ["a link outside the backup", (path: string) => {
    real.rmSync(join(path, "config/config.json"));
    real.symlinkSync(join(source.home, "config.json"), join(path, "config/config.json"));
  }, "links outside its folder"],
  ["a corrupted config", (path: string) => {
    real.writeFileSync(join(path, "config/config.json"), "[]");
    rewrite(path, m => { m.files[1].size = 2; m.files[1].sha256 = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"; });
  }, "configuration is corrupted"],
  ["a schema version that differs from the database", (path: string) => rewrite(path, m => { m.schemaVersion = 3; }), "schema version differs"],
  ["counts that differ from the database", (path: string) => rewrite(path, m => { m.counts.jobs = 9; }), "record counts differ"],
] as const)("inspection rejects %s", (_name, edit, message) => {
  const damaged = copyWith(backup.path, edit);
  expect(() => source.inspect.inspectBackup(damaged)).toThrow(message);
});

test("a failed restore puts the previous workspace back", async () => {
  const target = await open();
  target.sql("INSERT INTO jobs (id, title) VALUES (5, 'Kept')");
  expect(() => target.restore.restoreBackup(backup.path, backup.fingerprint, { beforeOpen: () => { throw "power loss"; } }))
    .toThrow("previous workspace was kept: power loss");
  expect(target.rows("SELECT title FROM jobs")).toEqual([{ title: "Kept" }]);
  expect(real.readdirSync(join(target.home, "backups"))).toEqual([]);
  expect(() => target.restore.restoreBackup(backup.path, "stale")).toThrow("changed after it was reviewed");
  target.close();
});
