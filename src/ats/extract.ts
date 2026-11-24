import { VOCABULARY, foldText, scanTerms, type TermCategory } from "./vocabulary.ts";

export type KeywordSection = "required" | "preferred" | "other";
/** A vocabulary term the job asks for, weighted by the section it appears in. */
export interface JobKeyword { term: string; category: TermCategory; weight: number; section: KeywordSection }

/** Weight of a term by section: required terms count three times a nice-to-have. */
export const SECTION_WEIGHTS: Readonly<Record<KeywordSection, number>> = { required: 3, other: 2, preferred: 1 };
export const MAX_KEYWORDS = 40;

// Headings are matched folded (no accents) and in lower case, in English and Portuguese.
const PREFERRED = /nice[ -]to[ -]have|good to have|diferencia(l|is)|desejave(l|is)|bonus|\bplus(es)?\b|preferred|preferencia(l|is)?|it'?s a plus|sera um/;
const REQUIRED = /requirement|requisito|must[ -]haves?|obrigatori|what you'?ll need|what you need|what we'?re looking for|o que (voce precisa|buscamos|esperamos)|qualifica(tions|coes|cao)|required|you have|voce tem|skills|competencias|conhecimentos/;
const OTHER = /responsib|responsabilidade|atividades|what you'?ll do|o que voce (vai fazer|fara)|about|sobre|benefits|beneficios|perks|why join|our team|nosso time|a empresa|the company|the role|a vaga|descricao|description|day to day|dia a dia/;
const DECORATION = /^[\s#*_>•·\-–—]+|[\s*_]+$/g;
const BULLET = /^\s*([-*•·–—]|\d+[.)])\s+/;
const MAX_HEADING = 60;

function classify(heading: string): KeywordSection | null {
  const text = foldText(heading).toLowerCase();
  if (PREFERRED.test(text)) return "preferred";
  if (REQUIRED.test(text)) return "required";
  if (OTHER.test(text)) return "other";
  return null;
}

/**
 * The section a line opens, and the text after an inline heading
 * ("Requisitos: C#, .NET"). Bullets are never standalone headings, and an
 * inline heading in a bullet applies to that bullet only.
 */
function heading(line: string): { section: KeywordSection; rest: string; persist: boolean } | null {
  // A standalone heading is short and names no technology: "Strong skills in C#" is a requirement, not a heading.
  const bullet = BULLET.test(line);
  const clean = line.replace(BULLET, "").replace(DECORATION, "");
  const colon = clean.indexOf(":");
  if (colon > 0 && colon <= MAX_HEADING) {
    const section = classify(clean.slice(0, colon));
    const rest = clean.slice(colon + 1).trim();
    if (section) return { section, rest, persist: !bullet || !rest };
    if (!rest && !bullet) return { section: "other", rest, persist: true };
  }
  if (bullet || clean.length > MAX_HEADING || colon > 0) return null;
  const section = classify(clean);
  return section && clean.split(" ").length <= 6 && !scanTerms(clean).length ? { section, rest: "", persist: true } : null;
}

/**
 * The vocabulary terms of a job description with their weight: 3 under
 * requirements, 1 under nice-to-have and 2 elsewhere. A term in several sections
 * keeps its highest weight. At most 40 terms, heaviest first, then in order of appearance.
 */
export function jobKeywords(description: string | null | undefined): JobKeyword[] {
  const found = new Map<number, { section: KeywordSection; order: number }>();
  let section: KeywordSection = "other";
  let order = 0;
  for (const line of (description ?? "").split(/\r?\n/)) {
    const opened = heading(line);
    if (opened?.persist) section = opened.section;
    const current = opened?.section ?? section;
    for (const hit of scanTerms(opened ? opened.rest : line)) {
      const previous = found.get(hit.index);
      if (!previous) found.set(hit.index, { section: current, order: order++ });
      else if (SECTION_WEIGHTS[current] > SECTION_WEIGHTS[previous.section]) previous.section = current;
    }
  }
  return [...found].sort(([, a], [, b]) => SECTION_WEIGHTS[b.section] - SECTION_WEIGHTS[a.section] || a.order - b.order).slice(0, MAX_KEYWORDS)
    .map(([index, { section }]) => ({ term: VOCABULARY[index]!.term, category: VOCABULARY[index]!.category, weight: SECTION_WEIGHTS[section], section }));
}
