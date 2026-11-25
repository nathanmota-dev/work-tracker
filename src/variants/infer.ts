import { jobKeywords } from "../ats/extract.ts";
import { scanTerms, VOCABULARY, type TermCategory } from "../ats/vocabulary.ts";
import type { VariantProfile, VariantRole } from "./types.ts";
import { variantProfile } from "./validation.ts";

const MAX_STACKS = 6;
const STACK_CATEGORIES: readonly TermCategory[] = ["language", "framework"];
const FALLBACK_CATEGORIES: readonly TermCategory[] = ["database", "cloud"];
const FRONTEND = new Set(["React", "Next.js", "Redux", "Angular", "AngularJS", "Vue.js", "Nuxt", "Svelte", "Tailwind CSS", "Bootstrap", "jQuery", "HTML", "CSS", "Sass"]);
// Used on both sides, or for mobile apps: they say nothing about front-end versus back-end.
const NEUTRAL = new Set(["JavaScript", "TypeScript", "React Native", "Flutter", "Dart", "Swift"]);
const ROLE_TERMS: Readonly<Record<string, VariantRole>> = { "Front-end": "frontend", "Back-end": "backend", "Full stack": "fullstack" };

/** Distinct terms of the given categories, in order of appearance. */
function terms(text: string, categories: readonly TermCategory[]): string[] {
  const found = scanTerms(text).map(hit => VOCABULARY[hit.index]!).filter(entry => categories.includes(entry.category)).map(entry => entry.term);
  return [...new Set(found)];
}

/** The role a text names: Full stack, or front-end and back-end together, mean full stack. */
function namedRole(text: string): VariantRole | null {
  const roles = new Set(terms(text, ["role"]).map(term => ROLE_TERMS[term]).filter(Boolean));
  if (roles.has("fullstack") || (roles.has("frontend") && roles.has("backend"))) return "fullstack";
  return roles.has("frontend") ? "frontend" : roles.has("backend") ? "backend" : null;
}

/** Front-end and back-end technologies together mean full stack; mobile and shared languages are ignored. */
function stackRole(stacks: string[]): VariantRole | null {
  const sided = stacks.filter(stack => !NEUTRAL.has(stack));
  const front = sided.some(stack => FRONTEND.has(stack));
  const back = sided.some(stack => !FRONTEND.has(stack));
  return front && back ? "fullstack" : front ? "frontend" : back ? "backend" : null;
}

/** The job's languages and frameworks, required ones first; databases and clouds only when it names none. */
function jobStacks(title: string, description: string): string[] {
  const keywords = jobKeywords(description);
  const pick = (categories: readonly TermCategory[]) => keywords.filter(item => categories.includes(item.category)).map(item => item.term);
  const stacks = pick(STACK_CATEGORIES);
  const fromTitle = terms(title, STACK_CATEGORIES);
  const merged = [...new Set([...fromTitle, ...stacks])];
  return (merged.length ? merged : pick(FALLBACK_CATEGORIES)).slice(0, MAX_STACKS);
}

/**
 * The name, role and stacks of a resume tailored for a job, read from the job
 * without an agent: the role named in the title, else the one its stack
 * implies, else the one its description names; the stacks are the languages
 * and frameworks it asks for. The candidate can edit them in Resumes.
 */
export function inferVariantProfile(job: { title?: string | null; description?: string | null }): VariantProfile {
  const title = (job.title ?? "").trim();
  const description = job.description ?? "";
  const stacks = jobStacks(title, description);
  const role = namedRole(title) ?? stackRole(stacks) ?? namedRole(description) ?? "other";
  return variantProfile({ name: title.slice(0, 80) || "Tailored resume", role, stacks: stacks.length ? stacks : ["General"] });
}
