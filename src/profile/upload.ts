import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { paths } from "../paths.ts";
import { PreparationError, parseResumeData } from "../preparation/resume-data.ts";
import { MAX_ASSETS, MAX_ASSET_BYTES, profileAssets } from "./assets.ts";
import { DATA_FILE, profileEvidence } from "./evidence.ts";
import { readBbox } from "./linkedin/bbox.ts";
import { isLinkedInExport } from "./linkedin/detect.ts";
import type { StructuredSource, UploadResult } from "./types.ts";
export type { UploadResult } from "./types.ts";

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
/** Write next to the target, so the folder never shows a partial file; `publish` renames it into place. */
async function staged<T>(dir: string, bytes: Buffer, use: (temporary: string, publish: (path: string) => void) => Promise<T>): Promise<T> {
  const temporary = join(dir, `.upload-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    return await use(temporary, path => renameSync(temporary, path));
  } finally { rmSync(temporary, { force: true }); }
}
/** A readable export of LinkedIn's "Save to PDF"; any other PDF is a reference resume. */
async function isLinkedInPdf(path: string): Promise<boolean> {
  try { return isLinkedInExport(await readBbox(path)); }
  catch { return false; }
}
/** The app's profile folder, created on the first upload. */
function profileFolder(): string {
  mkdirSync(paths.profile, { recursive: true, mode: 0o700 });
  return paths.profile;
}

function freeName(dir: string, name: string): string {
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${extension}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}
/**
 * The profile has one structured source: a new data file or LinkedIn export
 * replaces the current one, and only after a confirmation (`replace`).
 */
function replaces(dir: string, replace: boolean, file: string, kind: UploadResult["kind"]): { result: UploadResult | null; previous: StructuredSource | null } {
  const previous = profileEvidence(dir).source;
  if (previous && !replace) return { result: { file, kind, status: "replace_required", replaces: previous.file }, previous };
  return { result: null, previous };
}
const remove = (dir: string, source: StructuredSource | null) => { if (source) rmSync(join(dir, source.file), { force: true }); };

async function addPdf(dir: string, name: string, bytes: Buffer, replace: boolean): Promise<UploadResult> {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new PreparationError(`${name} is not a PDF.`);
  const { assets } = profileAssets(dir);
  const same = assets.find(asset => asset.sha256 === sha256(bytes));
  if (same) return { file: same.file, kind: "pdf", status: "unchanged" };
  if (assets.length >= MAX_ASSETS) throw new PreparationError(`The profile already has ${MAX_ASSETS} PDFs. Remove one from the profile folder first.`, 409);
  const file = freeName(dir, name.replace(/\.pdf$/i, ".pdf"));
  return staged(dir, bytes, async (temporary, publish) => {
    const structured = await isLinkedInPdf(temporary);
    const { result, previous } = structured ? replaces(dir, replace, file, "pdf") : { result: null, previous: null };
    if (result) return result;
    publish(join(dir, file));
    remove(dir, previous);
    return { file, kind: "pdf", status: "added" };
  });
}
async function addData(dir: string, bytes: Buffer, replace: boolean): Promise<UploadResult> {
  parseResumeData(bytes.toString("utf8"), ".json");
  const target = join(dir, DATA_FILE);
  if (existsSync(target) && readFileSync(target).equals(bytes)) return { file: DATA_FILE, kind: "data", status: "unchanged" };
  const { result, previous } = replaces(dir, replace, DATA_FILE, "data");
  if (result) return result;
  await staged(dir, bytes, async (_temporary, publish) => publish(target));
  if (previous?.kind === "linkedin") remove(dir, previous);
  return { file: DATA_FILE, kind: "data", status: "added" };
}

/**
 * Copy one uploaded PDF or resume data file into the profile folder. The data
 * file and a LinkedIn export are the profile itself, so one replaces the other;
 * other PDFs are added as reference resumes.
 */
export async function uploadProfileFile(body: Record<string, unknown>): Promise<{ dir: string; result: UploadResult }> {
  const name = safeName(body.name);
  const kind = /\.pdf$/i.test(name) ? "pdf" : /\.json$/i.test(name) ? "data" : null;
  if (!kind) throw new PreparationError("Choose a PDF or a .json resume data file.");
  const bytes = decode(body.base64);
  const dir = profileFolder();
  const replace = body.replace === true;
  return { dir, result: kind === "data" ? await addData(dir, bytes, replace) : await addPdf(dir, name, bytes, replace) };
}
