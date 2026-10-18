import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { SCHEMA_VERSION } from "../db/schema.ts";
import type { BackupSummary, ExcludedSource } from "./types.ts";
export type { BackupSummary, ExcludedSource } from "./types.ts";

/**
 * A workspace backup is a directory holding `manifest.json` plus the files it
 * lists: one SQLite snapshot, the config and the internal artifact tree. Only
 * listed files are ever read back, each one checked by size and SHA-256.
 */
export const BACKUP_FORMAT = "work-tracker-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const DATABASE_FILE = "database/work-tracker.db";
export const CONFIG_FILE = "config/config.json";
export const ARTIFACTS_DIR = "artifacts";

export class BackupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/**
 * @property kind Which workspace area the file restores into.
 * @property path Backup-relative POSIX path; never absolute or escaping the backup.
 */
export interface BackupFile {
  path: string;
  kind: "database" | "config" | "artifact";
  size: number;
  sha256: string;
}

/**
 * @property sourceHome WORK_TRACKER_HOME the backup was taken from; stored
 *   artifact paths under it are rebased onto the restoring workspace.
 * @property counts Row count per SQLite table in the snapshot.
 */
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  sourceHome: string;
  counts: Record<string, number>;
  files: BackupFile[];
  excluded: ExcludedSource[];
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileDigest(path: string): { size: number; sha256: string; bytes: Buffer } {
  const bytes = readFileSync(path);
  return { size: bytes.length, sha256: sha256(bytes), bytes };
}

/** True for a normalized relative POSIX path that stays inside its root. */
export function isContainedPath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || posix.isAbsolute(value)) return false;
  const normal = posix.normalize(value);
  return normal === value && normal !== "." && !normal.startsWith("../") && normal !== "..";
}

function kindFor(path: string): BackupFile["kind"] | null {
  if (path === DATABASE_FILE) return "database";
  if (path === CONFIG_FILE) return "config";
  return path.startsWith(`${ARTIFACTS_DIR}/`) ? "artifact" : null;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function parseFile(value: unknown): BackupFile {
  if (!isRecord(value) || typeof value.path !== "string" || !isCount(value.size) || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256))
    throw new BackupError("The backup manifest lists an invalid file entry.");
  if (!isContainedPath(value.path)) throw new BackupError(`The backup lists a path outside the backup folder: ${value.path}`);
  const kind = kindFor(value.path);
  if (!kind || value.kind !== kind) throw new BackupError(`The backup lists an unexpected file: ${value.path}`);
  return { path: value.path, kind, size: value.size, sha256: value.sha256 };
}

function parseFiles(value: unknown): BackupFile[] {
  if (!Array.isArray(value)) throw new BackupError("The backup manifest has no file list.");
  const files = value.map(parseFile);
  const unique = new Set(files.map(file => file.path));
  if (unique.size !== files.length) throw new BackupError("The backup manifest lists a file twice.");
  if (files.filter(file => file.kind === "database").length !== 1) throw new BackupError("The backup does not contain exactly one database.");
  return files;
}

/** Parse and check manifest structure and compatibility without touching listed files. */
export function parseManifest(text: string): BackupManifest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError("The backup manifest is corrupted and cannot be read."); }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError("This folder is not a Work Tracker backup.");
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION)
    throw new BackupError(`Backup format v${String(raw.formatVersion)} is not supported by this Work Tracker (v${BACKUP_FORMAT_VERSION}).`);
  if (!isCount(raw.schemaVersion)) throw new BackupError("The backup manifest has an invalid schema version.");
  if (raw.schemaVersion > SCHEMA_VERSION)
    throw new BackupError(`The backup uses database schema v${raw.schemaVersion}, newer than this Work Tracker supports (v${SCHEMA_VERSION}). Update Work Tracker first.`);
  if (typeof raw.appVersion !== "string" || typeof raw.sourceHome !== "string" || typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt)))
    throw new BackupError("The backup manifest is missing its version, origin or date.");
  if (!isRecord(raw.counts) || !Object.values(raw.counts).every(isCount)) throw new BackupError("The backup manifest has invalid record counts.");
  const excluded = Array.isArray(raw.excluded) ? raw.excluded.filter(isRecord).map(item => ({ kind: String(item.kind), path: String(item.path), reason: String(item.reason) }) as ExcludedSource) : [];
  return {
    format: BACKUP_FORMAT, formatVersion: raw.formatVersion, appVersion: raw.appVersion, schemaVersion: raw.schemaVersion,
    createdAt: raw.createdAt, sourceHome: raw.sourceHome, counts: raw.counts as Record<string, number>,
    files: parseFiles(raw.files), excluded,
  };
}

export function summarize(path: string, manifest: BackupManifest, text: string): BackupSummary {
  const { createdAt, appVersion, schemaVersion, counts, excluded, files } = manifest;
  return {
    path, fingerprint: sha256(text), createdAt, appVersion, schemaVersion, counts, excluded, files: files.length,
    artifacts: files.filter(file => file.kind === "artifact").length, bytes: files.reduce((total, file) => total + file.size, 0),
  };
}
