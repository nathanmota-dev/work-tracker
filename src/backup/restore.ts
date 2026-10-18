import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { closeDb, db } from "../db/index.ts";
import { migrateDatabase } from "../db/migrations.ts";
import { Database } from "../db/sqlite.ts";
import { ensureHome, paths } from "../paths.ts";
import { assertIntact } from "../db/snapshot.ts";
import { ARTIFACTS_DIR, BackupError, errorText } from "./format.ts";
import type { RestoreResult } from "./types.ts";
import { inspectBackup, type BackupInspection } from "./inspect.ts";

/** @property [beforeOpen] Test seam run after the swap, before the restored database is opened. */
export interface RestoreOptions {
  beforeOpen?: () => void;
}

const STAGED_DB = "work-tracker.db";
const STAGED_CONFIG = "config.json";

function stagedTarget(path: string): string {
  if (path.startsWith(`${ARTIFACTS_DIR}/`)) return path;
  return path.endsWith(".db") ? STAGED_DB : STAGED_CONFIG;
}

/** Point stored artifact paths from the backed-up home at this workspace. */
function rebaseArtifacts(d: Database, sourceHome: string): void {
  const from = `${join(sourceHome, ARTIFACTS_DIR)}${sep}`;
  const rebase = (value: unknown) =>
    typeof value === "string" && value.startsWith(from) ? join(paths.artifacts, value.slice(from.length)) : value;
  d.transaction(() => {
    for (const row of d.query("SELECT id, path FROM pdf_artifacts").all() as { id: string; path: string }[])
      d.query("UPDATE pdf_artifacts SET path = ? WHERE id = ?").run(rebase(row.path) as string, row.id);
    for (const row of d.query("SELECT id, manifest_json FROM application_runs").all() as { id: string; manifest_json: string }[]) {
      let next: string;
      try { next = JSON.stringify(JSON.parse(row.manifest_json), (_key, value) => rebase(value)); } catch { continue; }
      d.query("UPDATE application_runs SET manifest_json = ? WHERE id = ?").run(next, row.id);
    }
  })();
}

/** Write the checked bytes into a private staging folder and bring the database up to date there. */
function stage(inspection: BackupInspection, staging: string): void {
  mkdirSync(join(staging, ARTIFACTS_DIR), { recursive: true, mode: 0o700 });
  for (const [path, bytes] of inspection.bytes) {
    const target = join(staging, stagedTarget(path));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
  if (!existsSync(join(staging, STAGED_CONFIG))) writeFileSync(join(staging, STAGED_CONFIG), "{}\n", { mode: 0o600 });
  const d = new Database(join(staging, STAGED_DB));
  try {
    // Rollback journal so the staged file is complete on its own when renamed.
    d.exec("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
    migrateDatabase(d, { backupDir: join(staging, "migration-snapshots") });
    rebaseArtifacts(d, inspection.manifest.sourceHome);
    assertIntact(d, "The restored database failed its integrity check");
  } finally { d.close(); }
}

/**
 * Replace the live database, config and artifacts with the staged copies using
 * renames inside the workspace. Until the restored database opens, every step
 * is undone on failure, so the previous workspace is never partially replaced.
 */
function swap(staging: string, previous: string, options: RestoreOptions): void {
  const live: [string, string][] = [
    [paths.db, STAGED_DB], [`${paths.db}-wal`, `${STAGED_DB}-wal`], [`${paths.db}-shm`, `${STAGED_DB}-shm`],
    [paths.config, STAGED_CONFIG], [paths.artifacts, ARTIFACTS_DIR],
  ];
  const moved: [string, string][] = [];
  const placed: string[] = [];
  mkdirSync(previous, { recursive: true, mode: 0o700 });
  closeDb();
  try {
    for (const [path, name] of live.filter(([path]) => existsSync(path))) {
      renameSync(path, join(previous, name));
      moved.push([path, join(previous, name)]);
    }
    for (const [path, name] of [[paths.db, STAGED_DB], [paths.config, STAGED_CONFIG], [paths.artifacts, ARTIFACTS_DIR]] as const) {
      renameSync(join(staging, name), path);
      placed.push(path);
    }
    options.beforeOpen?.();
    db();
  } catch (error) {
    closeDb();
    for (const path of placed) rmSync(path, { recursive: true, force: true });
    for (const [path, saved] of moved.reverse()) renameSync(saved, path);
    rmSync(previous, { recursive: true, force: true });
    db();
    throw new BackupError(`Restore failed and your previous workspace was kept: ${errorText(error)}`, 500);
  }
}

/**
 * Restore the backup at `location` after re-validating it. `fingerprint` must
 * be the one shown when the user reviewed the backup. Callers must refuse
 * while an execution is active.
 */
export function restoreBackup(location: unknown, fingerprint: unknown, options: RestoreOptions = {}): RestoreResult {
  const inspection = inspectBackup(location);
  if (fingerprint !== inspection.summary.fingerprint) throw new BackupError("The backup changed after it was reviewed. Check it again before restoring.", 409);
  ensureHome();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staging = join(paths.home, `.restore-${stamp}`);
  const previous = join(paths.backups, `pre-restore-${stamp}`);
  try {
    stage(inspection, staging);
    swap(staging, previous, options);
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return { restored: inspection.summary, previous };
}
