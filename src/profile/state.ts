import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseResumeData, sourcesConfig } from "../preparation/sources.ts";
import type { ResumeSourcesConfig } from "../preparation/types.ts";
import { profileEvidence } from "./evidence.ts";
import { aboutFromSources, personalFromSources } from "./personal.ts";
import { profileResume } from "./resume.ts";
import type { ProfileAssetState, ProfileSources, ProfileSourcesState } from "./types.ts";

function dataFile(path: string): { data: Record<string, unknown> | null; asset: ProfileAssetState } {
  const file = basename(path);
  try { return { data: parseResumeData(readFileSync(path, "utf8"), extname(path)), asset: { file, kind: "data", status: "imported", warnings: [] } }; }
  catch (error) {
    const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? "The resume data file does not exist." : (error as Error).message;
    return { data: null, asset: { file, kind: "data", status: "failed", warnings: [message] } };
  }
}

/** Files of the profile folder with their import status, the extracted LinkedIn experience, the conflicts and the personal details. */
export function profileSourcesState(config: ResumeSourcesConfig = sourcesConfig()): ProfileSourcesState {
  const data = config.dataFile ? dataFile(config.dataFile) : null;
  const assets = data ? [data.asset] : [];
  const warnings = data?.asset.warnings.map(warning => `${data.asset.file}: ${warning}`) ?? [];
  const values = data?.data ?? null;
  if (!config.profileDir) return { profileDir: "", dataFile: config.dataFile, assets, linkedin: null, conflicts: [], personal: personalFromSources(values, null, []), about: aboutFromSources(values, null), resume: profileResume(values, null, []), warnings };
  const evidence = profileEvidence(config.profileDir, values);
  const references = (evidence.data?.profileSources as ProfileSources | undefined)?.references ?? [];
  const linkedin = evidence.linkedin && { experiences: evidence.linkedin.experience.length, education: evidence.linkedin.education.length, skills: evidence.linkedin.topSkills.length, languages: evidence.linkedin.languages.length, entries: evidence.linkedin.experience };
  return {
    profileDir: config.profileDir, dataFile: config.dataFile, assets: [...assets, ...evidence.assets], linkedin, conflicts: evidence.conflicts,
    personal: personalFromSources(values, evidence.linkedin, references), about: aboutFromSources(values, evidence.linkedin), resume: profileResume(values, evidence.linkedin, evidence.conflicts), warnings: [...warnings, ...evidence.warnings],
  };
}
