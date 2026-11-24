import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_ASSETS = 10;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
/** A PDF of the profile folder, identified by the hash of its bytes. */
export interface ProfileAsset { file: string; path: string; sha256: string }

const hashes = new Map<string, { stamp: string; sha256: string }>();
/** Hash a file once per size and modification time: snapshots read the folder often. */
function sha256(path: string, size: number, modified: number): string {
  const stamp = `${size}:${modified}`;
  const cached = hashes.get(path);
  if (cached?.stamp === stamp) return cached.sha256;
  const value = createHash("sha256").update(readFileSync(path)).digest("hex");
  hashes.set(path, { stamp, sha256: value });
  return value;
}

/**
 * PDFs at the top level of the profile folder, by name: no recursion and no
 * symbolic links, at most 10 files of up to 20 MB each.
 */
export function profileAssets(dir: string): { assets: ProfileAsset[]; warnings: string[] } {
  const warnings: string[] = [];
  const assets: ProfileAsset[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).filter(entry => /\.pdf$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) { warnings.push(`${entry.name} is a link and was skipped. Copy the PDF into the profile folder.`); continue; }
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const stats = statSync(path);
    if (stats.size > MAX_ASSET_BYTES) { warnings.push(`${entry.name} exceeds 20 MB and was skipped.`); continue; }
    if (assets.length === MAX_ASSETS) { warnings.push(`Only the first ${MAX_ASSETS} PDFs of the profile folder are used.`); break; }
    assets.push({ file: entry.name, path, sha256: sha256(path, stats.size, stats.mtimeMs) });
  }
  return { assets, warnings };
}
