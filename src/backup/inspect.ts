import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { readVersion, rowCounts } from "../db/migrations.ts";
import { Database } from "../db/sqlite.ts";
import { existingDirectory, isInside } from "./create.ts";
import { assertIntact } from "../db/snapshot.ts";
import { BackupError, DATABASE_FILE, MANIFEST_FILE, errorText, fileDigest, isRecord, parseManifest, summarize, type BackupFile, type BackupManifest, type BackupSummary } from "./format.ts";

/**
 * @property root Resolved backup folder.
 * @property bytes Verified contents of every listed file, keyed by backup path,
 *   so a restore stages exactly the bytes that were checked.
 */
export interface BackupInspection {
  root: string;
  manifest: BackupManifest;
  summary: BackupSummary;
  bytes: Map<string, Buffer>;
}

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

function regularFile(root: string, name: string): string {
  const path = join(root, name);
  let real: string;
  try { real = realpathSync(path); } catch { throw new BackupError(`The backup is missing ${name}.`); }
  if (!isInside(root, real)) throw new BackupError(`The backup links outside its folder: ${name}`);
  if (!lstatSync(path).isFile()) throw new BackupError(`The backup entry is not a regular file: ${name}`);
  return path;
}

function verifiedBytes(root: string, file: BackupFile): Buffer {
  const { size, sha256, bytes } = fileDigest(regularFile(root, file.path));
  if (size !== file.size || sha256 !== file.sha256) throw new BackupError(`The backup is damaged: ${file.path} does not match its recorded hash.`);
  return bytes;
}

function checkDatabase(path: string, manifest: BackupManifest): void {
  const copy = new Database(path, { readOnly: true });
  try {
    assertIntact(copy, "quick check");
    if (readVersion(copy) !== manifest.schemaVersion) throw new Error("schema version differs from the manifest");
    const counts = Object.fromEntries(rowCounts(copy));
    if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) throw new Error("record counts differ from the manifest");
  } finally { copy.close(); }
}

function verifyDatabase(root: string, manifest: BackupManifest): void {
  try { checkDatabase(join(root, DATABASE_FILE), manifest); }
  catch (error) { throw new BackupError(`The backup database failed its integrity check: ${errorText(error)}`); }
}

function verifyConfig(bytes: Buffer | undefined): void {
  if (!bytes) return;
  let value: unknown = null;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { /* reported below */ }
  if (!isRecord(value)) throw new BackupError("The backup configuration is corrupted.");
}

/**
 * Validate a backup folder end to end without modifying it: manifest format and
 * version, every listed path and hash, the database integrity and its counts.
 */
export function inspectBackup(location: unknown): BackupInspection {
  const root = existingDirectory(location, "backup");
  const manifestPath = regularFile(root, MANIFEST_FILE);
  if (lstatSync(manifestPath).size > MAX_MANIFEST_BYTES) throw new BackupError("The backup manifest is too large.");
  const text = readFileSync(manifestPath, "utf8");
  const manifest = parseManifest(text);
  const bytes = new Map(manifest.files.map(file => [file.path, verifiedBytes(root, file)]));
  verifyDatabase(root, manifest);
  verifyConfig(bytes.get(manifest.files.find(file => file.kind === "config")?.path ?? ""));
  return { root, manifest, summary: summarize(root, manifest, text), bytes };
}
