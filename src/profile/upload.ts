import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadConfig, paths, saveConfig } from "../paths.ts";
import { PreparationError, parseResumeData, sourcesConfig } from "../preparation/sources.ts";
import type { ResumeSourcesConfig } from "../preparation/types.ts";
import { MAX_ASSETS, MAX_ASSET_BYTES, profileAssets } from "./assets.ts";
import { isFolder } from "./evidence.ts";
import type { UploadResult } from "./types.ts";
export type { UploadResult } from "./types.ts";

export const DATA_FILE = "resume-data.json";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const MAX_BASE64 = Math.ceil(MAX_ASSET_BYTES / 3) * 4;

/** Only the base name, without control characters, separators or a leading dot. */
export function safeName(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const value = basename(String(name ?? "").replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f/]/g, "").replace(/^\.+/, "").trim();
  if (!value || value.length > 200) throw new PreparationError("Choose a file with a valid name.");
  return value;
}
function decode(base64: unknown): Buffer {
  if (typeof base64 !== "string" || !base64) throw new PreparationError("The file is empty.");
  if (base64.length > MAX_BASE64) throw new PreparationError("Files must be 20 MB or smaller.");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new PreparationError("The file is empty.");
  if (bytes.length > MAX_ASSET_BYTES) throw new PreparationError("Files must be 20 MB or smaller.");
  return bytes;
}
/** Write next to the target and rename, so the folder never shows a partial file. */
function writeAtomic(path: string, bytes: Buffer): void {
  const temporary = join(path, "..", `.upload-${randomUUID()}.tmp`);
  try { writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

/** The configured profile folder, or the app's own one for a user who has none yet. */
function profileFolder(config: ResumeSourcesConfig): string {
  if (config.profileDir) {
    if (!isFolder(config.profileDir)) throw new PreparationError("The profile folder no longer exists. Choose another one in Base resume.", 409);
    return config.profileDir;
  }
  mkdirSync(paths.profile, { recursive: true, mode: 0o700 });
  return paths.profile;
}
/** Persist the folder and data file the upload used; other sources stay as they are. */
function remember(config: ResumeSourcesConfig, change: Partial<ResumeSourcesConfig>): void {
  const next = { ...config, ...change };
  if (next.profileDir === config.profileDir && next.dataFile === config.dataFile) return;
  saveConfig({ ...loadConfig(), resumeSources: next });
}

function freeName(dir: string, name: string): string {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${extension}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}
function addPdf(dir: string, name: string, bytes: Buffer): UploadResult {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PreparationError(`${name} is not a PDF.`);
  const { assets } = profileAssets(dir);
  const same = assets.find(asset => asset.sha256 === sha256(bytes));
  if (same) return { file: same.file, kind: "pdf", status: "unchanged" };
  if (assets.length >= MAX_ASSETS) throw new PreparationError(`The profile already has ${MAX_ASSETS} PDFs. Remove one from the profile folder first.`, 409);
  const file = freeName(dir, name.replace(/\.pdf$/i, ".pdf"));
  writeAtomic(join(dir, file), bytes);
  return { file, kind: "pdf", status: "added" };
}
function addData(dir: string, config: ResumeSourcesConfig, bytes: Buffer, replace: boolean): UploadResult {
  parseResumeData(bytes.toString("utf8"), ".json");
  const target = join(dir, DATA_FILE);
  // The upload becomes the data file in use: replacing different data needs a confirmation.
  const current = [config.dataFile, target].find(path => path && existsSync(path));
  const same = current ? readFileSync(current).equals(bytes) : false;
  if (current && !same && !replace) return { file: DATA_FILE, kind: "data", status: "replace_required" };
  const unchanged = same && current === target;
  if (!unchanged) writeAtomic(target, bytes);
  remember(config, { profileDir: dir, dataFile: target });
  return { file: DATA_FILE, kind: "data", status: unchanged ? "unchanged" : "added" };
}

/**
 * Copy one uploaded PDF or resume data file into the profile folder, exactly
 * as if the user had placed it there: the same folder rules apply.
 */
export function uploadProfileFile(body: Record<string, unknown>): { dir: string; result: UploadResult } {
  const name = safeName(body.name);
  const kind = /\.pdf$/i.test(name) ? "pdf" : /\.json$/i.test(name) ? "data" : null;
  if (!kind) throw new PreparationError("Choose a PDF or a .json resume data file.");
  const bytes = decode(body.base64);
  const config = sourcesConfig();
  const dir = profileFolder(config);
  if (kind === "data") return { dir, result: addData(dir, config, bytes, body.replace === true) };
  const result = addPdf(dir, name, bytes);
  remember(config, { profileDir: dir });
  return { dir, result };
}
