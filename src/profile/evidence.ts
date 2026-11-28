import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseResumeData } from "../preparation/resume-data.ts";
import { profileAssets } from "./assets.ts";
import { linkedinData } from "./linkedin-data.ts";
import { cachedImports } from "./store.ts";
import type { ProfileAssetState, ProfileReference, ProfileSources, StructuredSource } from "./types.ts";

type Data = Record<string, unknown>;
/** The resume data file of the profile folder; it replaces the LinkedIn export as the structured source. */
export const DATA_FILE = "resume-data.json";
/**
 * @property data The structured source in the data file's shape, its skills
 *   normalized, with `profileSources.references` when the folder has other
 *   resume PDFs; null when the folder has neither.
 * @property raw The structured source as written: the base resume shows its texts unchanged.
 */
export interface ProfileEvidence { data: Data | null; raw: Data | null; source: StructuredSource | null; warnings: string[]; assets: ProfileAssetState[] }

export function isFolder(path: string): boolean {
  try { return isAbsolute(path) && existsSync(path) && statSync(path).isDirectory(); }
  catch { return false; }
}

type Structured = Pick<ProfileEvidence, "data" | "raw" | "source">;
function dataFile(dir: string, assets: ProfileAssetState[], warnings: string[]): Structured | null {
  const path = join(dir, DATA_FILE);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const data = parseResumeData(text, ".json");
    assets.push({ file: DATA_FILE, kind: "data", status: "imported", warnings: [] });
    return { data, raw: JSON.parse(text) as Data, source: { kind: "data", file: DATA_FILE } };
  } catch (error) {
    const message = (error as Error).message;
    warnings.push(`${DATA_FILE}: ${message}`);
    assets.push({ file: DATA_FILE, kind: "data", status: "failed", warnings: [message] });
    return null;
  }
}

/**
 * The profile as the snapshot records it: one structured source, the resume
 * data file or else the first LinkedIn export, plus the text of the other
 * resume PDFs as references. Synchronous: a PDF without a valid import is left
 * out with a warning instead of being read here.
 */
export function profileEvidence(dir: string): ProfileEvidence {
  if (!isFolder(dir)) return { data: null, raw: null, source: null, warnings: [], assets: [] };
  const states: ProfileAssetState[] = [];
  const { assets, warnings } = profileAssets(dir);
  let structured = dataFile(dir, states, warnings);
  const cached = cachedImports(assets.map(asset => asset.sha256));
  const references: ProfileReference[] = [];
  for (const asset of assets) {
    const item = cached.get(asset.sha256);
    if (!item) { warnings.push(`${asset.file} has not been imported yet.`); states.push({ file: asset.file, kind: null, status: "pending", warnings: [] }); continue; }
    warnings.push(...item.warnings.map(warning => `${asset.file}: ${warning}`));
    states.push({ file: asset.file, kind: item.kind, status: item.text ? "imported" : "failed", warnings: item.warnings });
    if (!item.text) continue;
    if (item.profile && !structured) {
      const raw = linkedinData(item.profile);
      structured = { data: parseResumeData(JSON.stringify(raw), ".json"), raw, source: { kind: "linkedin", file: asset.file } };
      continue;
    }
    if (item.profile) warnings.push(`${asset.file} is a LinkedIn export, but ${structured!.source!.file} is your profile; the export is used as reference text only.`);
    references.push({ file: asset.file, text: item.text });
  }
  const profileSources: ProfileSources = { references };
  const data = references.length ? { ...structured?.data, profileSources } : structured?.data ?? null;
  return { data, raw: structured?.raw ?? null, source: structured?.source ?? null, warnings, assets: states };
}
