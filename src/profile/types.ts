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
/** The Contact section of the export; each field is "" when absent. URLs start with `https://`. */
export interface ProfileContact {
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
}
/** Plain text extracted from a LinkedIn "Save to PDF" export. */
export interface LinkedInProfile {
  name: string;
  contact: ProfileContact;
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

/** Text of a resume PDF that is not the LinkedIn export: evidence for tailoring, never the profile itself. */
export interface ProfileReference { file: string; text: string }
/** Evidence added to the profile under `profileSources`; the profile keys stay unchanged. */
export interface ProfileSources { references: ProfileReference[] }
/** The one structured source of the profile: the resume data file or the LinkedIn export. */
export interface StructuredSource { kind: "data" | "linkedin"; file: string }

export type PersonalKey = "first_name" | "last_name" | "full_name" | "email" | "phone" | "location" | "city" | "state" | "country" | "summary" | "languages" | "linkedin_url" | "github_url" | "portfolio_url";
/** Where a personal detail came from: the data file, the LinkedIn export or another resume PDF. */
export type PersonalSource = "data" | "linkedin" | "resume";
export interface PersonalField { key: PersonalKey; value: string; source: PersonalSource }
/** Read-only details the resume sources hold beyond the answer catalog. */
export interface ProfileAbout {
  headline: string;
  summary: string;
  currentCompany: string;
  skills: string[];
  languages: { name: string; level: string }[];
  certifications: string[];
}

/** One role or course as the Profile page shows it; `source` tells which files describe it. */
export interface ResumeEntry {
  title: string;
  organization: string;
  start: ProfileDate;
  end: ProfileDate;
  location: string;
  bullets: string[];
  skills: string[];
  /** Kept as evidence for tailored resumes but left out of the base resume. */
  hidden?: boolean;
}
/** Experience and education of the structured source, most recent first. */
export interface ProfileResume {
  experience: ResumeEntry[];
  education: ResumeEntry[];
}

export type AssetStatus ="imported" | "pending" | "failed";
export interface ProfileAssetState {
  file: string;
  kind: ImportKind | "data" | null;
  status: AssetStatus;
  warnings: string[];
}
/** What the Profile page shows about the profile folder. */
export interface ProfileSourcesState {
  profileDir: string;
  assets: ProfileAssetState[];
  /** What the profile and the base resume are built from; null until one is uploaded. */
  source: StructuredSource | null;
  /** Personal details found in the sources, ready to fill the answer catalog. */
  personal: PersonalField[];
  about: ProfileAbout | null;
  resume: ProfileResume;
  warnings: string[];
  /** True while files of the folder are still being imported in the background. */
  importing?: boolean;
}
/**
 * One uploaded file. `added` wrote it to the profile folder; `unchanged` found
 * the same bytes there already; `replace_required` wrote nothing because it
 * would replace the current structured source (`replaces`) and `replace` was not set.
 */
export interface UploadResult { file: string; kind: "pdf" | "data"; status: "added" | "unchanged" | "replace_required"; replaces?: string }
