import type { LinkedInProfile } from "../types.ts";
import type { BboxPage } from "./bbox.ts";
import { parseContact } from "./contact.ts";
import { readingOrder } from "./columns.ts";
import { MAX_EXPERIENCES, countRoles, parseExperience, parseEducation } from "./experience.ts";
import { splitSections } from "./sections.ts";

/** Bump to invalidate every cached LinkedIn extraction. Version 2 adds the Contact section. */
export const PARSER_VERSION = 2;
const MAX_SUMMARY = 4000;

/** Lines whose parentheses are still open continue on the next line: `Spanish (Limited` / `Working)`. */
function languages(lines: string[]): LinkedInProfile["languages"] {
  const joined: string[] = [];
  for (const line of lines) {
    const last = joined.at(-1);
    if (last !== undefined && last.split("(").length > last.split(")").length) joined[joined.length - 1] = `${last} ${line}`;
    else joined.push(line);
  }
  return joined.map(text => {
    const match = /^(.*?)\s*\(([^)]*)\)$/.exec(text);
    return match ? { name: match[1]!, level: match[2]! } : { name: text, level: "" };
  });
}

/** Deterministic extraction of a LinkedIn export, as plain text only. */
export function parseLinkedInProfile(pages: BboxPage[]): LinkedInProfile {
  const { sidebar, main } = readingOrder(pages);
  const side = splitSections(sidebar).sections;
  const { header, sections } = splitSections(main);
  const lines = sections.experience ?? [];
  const warnings: string[] = [];
  const experience = parseExperience(lines);
  if (!experience.length) warnings.push("No experience was found in the LinkedIn export.");
  if (countRoles(lines) > MAX_EXPERIENCES) warnings.push(`Only the first ${MAX_EXPERIENCES} experiences of the LinkedIn export were kept.`);
  const located = header.length >= 3;
  return {
    name: header[0] ?? "",
    contact: parseContact(side.contact ?? []),
    headline: header.slice(1, located ? -1 : undefined).join(" "),
    location: located ? header.at(-1)! : "",
    summary: (sections.summary ?? []).join(" ").slice(0, MAX_SUMMARY),
    topSkills: side.topSkills ?? [],
    languages: languages(side.languages ?? []),
    certifications: side.certifications ?? [],
    publications: side.publications ?? [],
    experience,
    education: parseEducation(sections.education ?? []),
    warnings,
  };
}
