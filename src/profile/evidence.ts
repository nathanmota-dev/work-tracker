import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { profileAssets } from "./assets.ts";
import { consolidateProfile } from "./consolidate.ts";
import { cachedImports, profileChoices } from "./store.ts";
import type { LinkedInProfile, ProfileAssetState, ProfileConflict, ProfileSources } from "./types.ts";

type Data = Record<string, unknown>;
export interface ProfileEvidence { data: Data | null; warnings: string[]; assets: ProfileAssetState[]; linkedin: LinkedInProfile | null; conflicts: ProfileConflict[] }

export function isFolder(path: string): boolean {
  try { return isAbsolute(path) && existsSync(path) && statSync(path).isDirectory(); }
  catch { return false; }
}

/**
 * The profile as the snapshot records it: the data file plus the cached
 * imports of the folder's PDFs and the decided conflicts. Synchronous: a PDF
 * without a valid import is left out with a warning instead of being read here.
 */
export function profileEvidence(dir: string, data: Data | null): ProfileEvidence {
  if (!isFolder(dir)) return { data, warnings: ["The profile folder does not exist. Select a folder or leave it empty."], assets: [], linkedin: null, conflicts: [] };
  const { assets, warnings } = profileAssets(dir);
  const cached = cachedImports(assets.map(asset => asset.sha256));
  const states: ProfileAssetState[] = [];
  const references: ProfileSources["references"] = [];
  let linkedin: LinkedInProfile | null = null;
  for (const asset of assets) {
    const item = cached.get(asset.sha256);
    if (!item) { warnings.push(`${asset.file} has not been imported yet.`); states.push({ file: asset.file, kind: null, status: "pending", warnings: [] }); continue; }
    warnings.push(...item.warnings.map(warning => `${asset.file}: ${warning}`));
    states.push({ file: asset.file, kind: item.kind, status: item.text ? "imported" : "failed", warnings: item.warnings });
    if (!item.text) continue;
    // A second export is still the candidate's own history: it is kept as reference text.
    if (item.profile && !linkedin) linkedin = item.profile;
    else references.push({ file: asset.file, text: item.text });
  }
  const consolidated = consolidateProfile(data, linkedin, references, profileChoices());
  const conflicts = (consolidated?.profileSources as ProfileSources | undefined)?.conflicts ?? [];
  const undecided = conflicts.filter(conflict => !conflict.chosen).length;
  if (undecided) warnings.push(`${undecided} profile ${undecided === 1 ? "conflict needs" : "conflicts need"} a decision.`);
  return { data: consolidated, warnings, assets: states, linkedin, conflicts };
}
