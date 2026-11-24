import { VOCABULARY, type VocabularyTerm } from "./vocabulary-data.ts";
export { VOCABULARY, type VocabularyTerm, type TermCategory } from "./vocabulary-data.ts";

/** Strip accents and collapse whitespace; case is kept for case-sensitive terms. */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");
}
/** Spaces and hyphens inside a term are optional: "front-end", "front end" and "frontend" are one spelling. */
const key = (form: string) => foldText(form).toLowerCase().replace(/[ -]/g, "");
const escape = (char: string) => /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
const pattern = (form: string) => [...foldText(form)].map(char => char === " " || char === "-" ? "[ -]?" : escape(char)).join("");

/**
 * Term boundaries respect `#`, `+` and `.`: "C#" is not "C", "Java" does not
 * match inside "JavaScript" and "Node" does not match inside "Node.js"; a dot
 * that only ends a sentence is still a boundary.
 */
function boundaries(word: string, alternatives: string[]): RegExp {
  return new RegExp(`(?<![${word}#+])(?<![${word}]\\.)(?:${alternatives.join("|")})(?![${word}#+])(?!\\.[${word}])`, "g");
}

type Compiled = { regex: RegExp; terms: Map<string, number> };
function compile(entries: [form: string, index: number][], word: string, normalize: (form: string) => string): Compiled {
  const terms = new Map<string, number>();
  for (const [form, index] of entries) {
    const existing = terms.get(normalize(form));
    if (existing !== undefined && existing !== index) throw new Error(`Vocabulary spelling "${form}" belongs to two terms.`);
    terms.set(normalize(form), index);
  }
  // Longest spellings first, so "Spring Boot" wins over "Spring" at the same position.
  const forms = [...new Set(entries.map(([form]) => form))].sort((a, b) => b.length - a.length).map(pattern);
  return { regex: boundaries(word, forms), terms };
}

const insensitive = compile(VOCABULARY.flatMap((entry, index) => [...(entry.caseSensitive ? [] : [entry.term]), ...entry.aliases].map(form => [form.toLowerCase(), index] as [string, number])), "a-z0-9_", key);
const sensitive = compile(VOCABULARY.flatMap((entry, index) => entry.caseSensitive ? [[entry.term, index] as [string, number]] : []), "A-Za-z0-9_", form => form);
const byName = new Map(VOCABULARY.map((entry, index) => [entry.term, index]));

/** One occurrence of a vocabulary term in a text. */
export interface TermHit { index: number; at: number }

/** Vocabulary terms in `text`, in order of appearance; repeated terms appear once per occurrence. */
export function scanTerms(text: string): TermHit[] {
  const folded = foldText(text);
  const hits: TermHit[] = [];
  for (const match of folded.toLowerCase().matchAll(insensitive.regex)) hits.push({ index: insensitive.terms.get(key(match[0]))!, at: match.index });
  if (sensitive.terms.size) for (const match of folded.matchAll(sensitive.regex)) hits.push({ index: sensitive.terms.get(match[0])!, at: match.index });
  return hits.sort((a, b) => a.at - b.at);
}

/** Canonical names a resume covers: every term it names and the broader terms they imply. */
export function resumeTerms(text: string): Set<string> {
  const covered = new Set<string>();
  for (const { index } of scanTerms(text)) {
    let entry: VocabularyTerm | undefined = VOCABULARY[index];
    while (entry && !covered.has(entry.term)) {
      covered.add(entry.term);
      entry = entry.parent ? VOCABULARY[byName.get(entry.parent)!] : undefined;
    }
  }
  return covered;
}

const listAliases = new Map(VOCABULARY.filter(entry => entry.category !== "role" && entry.category !== "practice")
  .flatMap(entry => [entry.term, ...entry.aliases, ...(entry.listOnly ?? [])].map(form => [foldText(form).trim().toLowerCase(), entry.term] as const)));

/** The canonical name of one skills-list entry ("ReactJs" → "React"); unknown names are kept as written. */
export function canonicalSkill(name: string): string {
  const trimmed = name.trim();
  return listAliases.get(foldText(trimmed).toLowerCase()) ?? trimmed;
}
