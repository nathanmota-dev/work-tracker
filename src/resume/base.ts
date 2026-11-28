import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { paths } from "../paths.ts";
import { PreparationError } from "../preparation/resume-data.ts";
import { profileEvidence } from "../profile/evidence.ts";
import { documentFromData, type ResumeDocument } from "./document.ts";
import { renderResume } from "./render.ts";

export const BASE_RESUME_FILE = "resume.tex";
export const NO_PROFILE = "Upload your resume data or LinkedIn PDF in Profile to build your base resume.";
type Edited = Partial<Record<"full_name" | "email" | "phone" | "location" | "summary" | "linkedin_url" | "github_url" | "portfolio_url", string>>;

/**
 * Personal details the user typed in Profile: a saved answer that differs from
 * what the profile filled into it. Filled values follow the profile, so a new
 * upload still changes them.
 */
export function editedAnswers(d: Database = db()): Edited {
  const rows = d.query(`SELECT a.key, a.value, f.value AS filled FROM applicant_answers a LEFT JOIN answer_autofill f ON f.key = a.key
    WHERE a.key IN ('full_name', 'email', 'phone', 'location', 'summary', 'linkedin_url', 'github_url', 'portfolio_url')`).all() as { key: keyof Edited; value: string | null; filled: string | null }[];
  return Object.fromEntries(rows.flatMap(row => { const value = row.value?.trim(); return value && value !== row.filled?.trim() ? [[row.key, value]] : []; }));
}

const PROFILES = { linkedin_url: /linkedin\.com/i, github_url: /github\.com/i } as const;
/** The edited link replaces the profile's link of the same site, or the website for a portfolio; otherwise it is added. */
function withLink(links: string[], key: keyof typeof PROFILES | "portfolio_url", url: string | undefined): string[] {
  if (!url) return links;
  const index = key === "portfolio_url" ? links.findIndex(link => !PROFILES.linkedin_url.test(link) && !PROFILES.github_url.test(link)) : links.findIndex(link => PROFILES[key].test(link));
  return index < 0 ? [...links, url] : links.map((link, i) => (i === index ? url : link));
}
/** The profile's resume with the personal details edited in Profile. */
export function withEditedAnswers(doc: ResumeDocument, edited: Edited): ResumeDocument {
  const links = (["linkedin_url", "github_url", "portfolio_url"] as const).reduce((list, key) => withLink(list, key, edited[key]), doc.links);
  return {
    ...doc, name: edited.full_name ?? doc.name, summary: edited.summary ?? doc.summary, links,
    contact: { location: edited.location ?? doc.contact.location, phone: edited.phone ?? doc.contact.phone, email: edited.email ?? doc.contact.email },
  };
}

/** The base resume's LaTeX from the profile, or null while the profile has no resume data or LinkedIn export. */
export function baseResumeLatex(): string | null {
  const { raw } = profileEvidence(paths.profile);
  return raw ? renderResume(withEditedAnswers(documentFromData(raw), editedAnswers())) : null;
}

/**
 * Write the base resume's LaTeX where every snapshot reads it, only when it
 * changed. Without a profile there is no base resume: the file is removed.
 */
export function writeBaseResume(): string {
  const path = join(paths.baseResume, BASE_RESUME_FILE);
  const tex = baseResumeLatex();
  if (!tex) { rmSync(path, { force: true }); throw new PreparationError(NO_PROFILE, 409); }
  mkdirSync(paths.baseResume, { recursive: true, mode: 0o700 });
  if (!existsSync(path) || readFileSync(path, "utf8") !== tex) writeFileSync(path, tex, { mode: 0o600 });
  return tex;
}
