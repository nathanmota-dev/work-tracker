import { runCommand } from "../preparation/command.ts";
import { normalizeText } from "../preparation/text-layer.ts";
import { profileAssets, type ProfileAsset } from "./assets.ts";
import { readBbox } from "./linkedin/bbox.ts";
import { isLinkedInExport } from "./linkedin/detect.ts";
import { parseLinkedInProfile } from "./linkedin/parse.ts";
import { cachedImports, saveImport } from "./store.ts";
import type { ProfileImport } from "./types.ts";

const MAX_TEXT = 20000;
export interface ImportResult { imported: number; cached: number; failed: number }

/** Extract one PDF. A failure becomes a warning on the cached record and never throws. */
async function extract(asset: ProfileAsset, signal?: AbortSignal): Promise<Omit<ProfileImport, "parserVersion">> {
  const base = { hash: asset.sha256, file: asset.file, profile: null };
  try {
    const pages = await readBbox(asset.path, signal);
    if (isLinkedInExport(pages)) {
      const profile = parseLinkedInProfile(pages);
      return { ...base, kind: "linkedin", profile, text: normalizeText(pages.flatMap(page => page.lines.map(line => line.text)).join("\n")).slice(0, MAX_TEXT), warnings: profile.warnings };
    }
    const text = normalizeText(await runCommand("pdftotext", ["-q", "-layout", asset.path, "-"], undefined, signal, 30000)).slice(0, MAX_TEXT);
    return { ...base, kind: "reference", text, warnings: text ? [] : ["The PDF has no extractable text. Scanned PDFs are not supported."] };
  } catch (error) {
    signal?.throwIfAborted();
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300);
    return { ...base, kind: "reference", text: "", warnings: [`The PDF could not be read: ${reason}`] };
  }
}

let queue: Promise<unknown> = Promise.resolve();
/**
 * Extract every PDF of the profile folder that has no valid import (same hash
 * and parser version). Idempotent; `force` extracts them all again. Imports
 * run one at a time so a generation and the Import button never race.
 */
export function importProfileAssets(dir: string, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<ImportResult> {
  const run = async () => {
    const { assets } = profileAssets(dir);
    const cached = options.force ? new Map() : cachedImports(assets.map(asset => asset.sha256));
    const result: ImportResult = { imported: 0, cached: 0, failed: 0 };
    for (const asset of assets) {
      if (cached.has(asset.sha256)) { result.cached++; continue; }
      const value = await extract(asset, options.signal);
      saveImport(value);
      if (value.text) result.imported++;
      else result.failed++;
    }
    return result;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
/** Before a generation: import what is missing, never blocking it. */
export async function ensureProfileImported(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await importProfileAssets(dir).catch(() => undefined);
}
