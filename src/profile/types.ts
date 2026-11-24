/** A date as the sources write it: `YYYY-MM`, `YYYY` or `Present`. */
export type ProfileDate = string;

/** One role of the LinkedIn export, in its own order (most recent first). */
export interface LinkedInExperience {
  company: string;
  title: string;
  start: ProfileDate;
  end: ProfileDate;
  location: string;
  bullets: string[];
}
export interface LinkedInEducation {
  school: string;
  degree: string;
  start: ProfileDate;
  end: ProfileDate;
}
/** Plain text extracted from a LinkedIn "Save to PDF" export. */
export interface LinkedInProfile {
  name: string;
  headline: string;
  location: string;
  summary: string;
  topSkills: string[];
  languages: { name: string; level: string }[];
  certifications: string[];
  publications: string[];
  experience: LinkedInExperience[];
  education: LinkedInEducation[];
  warnings: string[];
}

export type ImportKind = "linkedin" | "reference";
/** A cached extraction of one PDF, identified by its content hash. */
export interface ProfileImport {
  hash: string;
  kind: ImportKind;
  file: string;
  parserVersion: number;
  profile: LinkedInProfile | null;
  text: string;
  warnings: string[];
}

export type ChoiceSource = "data" | "linkedin";
/**
 * A date or location that the data file and the LinkedIn export disagree on.
 *
 * @property key Hash of the field, the entry and both values: changing either
 *   source reopens only the conflicts whose values changed.
 * @property chosen The user's decision; null until decided.
 */
export interface ProfileConflict {
  key: string;
  field: string;
  label: string;
  values: Record<ChoiceSource, string>;
  chosen: ChoiceSource | null;
}
export interface ResolvedValue {
  key: string;
  field: string;
  label: string;
  source: ChoiceSource;
  value: string;
}
/** Evidence added to the profile under `profileSources`; the data file keys stay unchanged. */
export interface ProfileSources {
  linkedin: LinkedInProfile | null;
  linkedinOnly: LinkedInExperience[];
  references: { file: string; text: string }[];
  conflicts: ProfileConflict[];
  resolved: ResolvedValue[];
}

export type AssetStatus = "imported" | "pending" | "failed";
export interface ProfileAssetState {
  file: string;
  kind: ImportKind | "data" | null;
  status: AssetStatus;
  warnings: string[];
}
/** What Profile → Base resume shows about the profile folder. */
export interface ProfileSourcesState {
  profileDir: string;
  dataFile: string;
  assets: ProfileAssetState[];
  linkedin: { experiences: number; education: number; skills: number; languages: number; entries: LinkedInExperience[] } | null;
  conflicts: ProfileConflict[];
  warnings: string[];
}
