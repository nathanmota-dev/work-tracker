import type { PdfArtifact } from "../preparation/types.ts";

export const VARIANT_ROLES = ["frontend", "backend", "fullstack", "other"] as const;
export const VARIANT_LANGUAGES = ["auto", "pt", "en"] as const;
export type VariantRole = typeof VARIANT_ROLES[number];
export type VariantLanguage = typeof VARIANT_LANGUAGES[number];
export type VariantStatus = "generating" | "ready" | "failed" | "cancelled" | "interrupted" | "waiting_for_sign_in";
export type VariantPhase = "preparing" | "tailoring" | "compiling" | "complete";

/** What identifies a variant for the candidate: the role and stacks it targets. */
export interface VariantProfile {
  name: string;
  role: VariantRole;
  stacks: string[];
}
/** A generation request; `focus` is extra guidance and `language` the resume's language. */
export interface VariantInput extends VariantProfile {
  focus: string | null;
  language: VariantLanguage;
  provider: string;
  model: string | null;
}

/** The application whose approved tailored resume a saved resume was copied from. */
export interface VariantSource {
  jobId: number;
  applicationId: number;
  documentVersionId: string | null;
  company: string | null;
  title: string | null;
}
/** The ATS keyword score of a saved resume against its source job; `score` is null when the job names too few keywords. */
export interface VariantMatch {
  score: number | null;
  band: "strong" | "partial" | "weak" | null;
}

/**
 * A resume generated once per role and stacks, imported as a ready PDF, or
 * copied from an approved tailored resume, and reused across applications.
 *
 * @property sourceVersion Version of the sources it was generated from; null when imported.
 * @property stale Generated from sources that changed since.
 * @property pdf The current PDF; earlier PDFs stay on disk for the documents that used them.
 * @property source The application it was tailored for; null when generated in Resumes or imported.
 * @property match Its score against the source job, filled by the list; null otherwise.
 */
export interface ResumeVariant extends VariantProfile {
  id: string;
  focus: string | null;
  language: VariantLanguage;
  origin: "generated" | "imported";
  status: VariantStatus;
  phase: VariantPhase | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  report: string | null;
  sourceVersion: string | null;
  events: Record<string, unknown>[];
  pdf: PdfArtifact | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  source: VariantSource | null;
  match: VariantMatch | null;
}

/** The manifest the resume-tailor skill reads: a role and stacks instead of a job. */
export interface VariantManifest {
  variantId: string;
  target: { kind: "variant"; role: VariantRole; stacks: string[]; focus: string | null; language: VariantLanguage };
  project: string;
  baseProject: string;
  mainFile: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  profilePath: string;
  reportPath: string;
  selectionPath: string;
  coverPath: null;
  sourceVersion: string;
  warnings: string[];
  manifestPath: string;
  /** Base preview the generation compared against; kept for documents made from it. */
  baseArtifactId: string;
}
