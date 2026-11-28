import { sourcesConfig } from "../preparation/sources.ts";
import type { ResumeSourcesConfig } from "../preparation/types.ts";
import { profileEvidence } from "./evidence.ts";
import { aboutFromSources, personalFromSources } from "./personal.ts";
import { profileResume } from "./resume.ts";
import type { ProfileSources, ProfileSourcesState } from "./types.ts";

/** Files of the profile folder with their import status, the structured source and what the profile reads from it. */
export function profileSourcesState(config: ResumeSourcesConfig = sourcesConfig()): ProfileSourcesState {
  const evidence = profileEvidence(config.profileDir);
  const references = (evidence.data?.profileSources as ProfileSources | undefined)?.references ?? [];
  const profile = evidence.source ? evidence.data : null;
  return {
    profileDir: config.profileDir, assets: evidence.assets, source: evidence.source,
    personal: personalFromSources(profile, evidence.source?.kind ?? null, references), about: aboutFromSources(profile), resume: profileResume(profile), warnings: evidence.warnings,
  };
}
