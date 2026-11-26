import { readFileSync } from "node:fs";
import { matchLabels, normalize } from "../match/matcher.ts";
import { KEY_BY_NAME } from "../match/synonyms.ts";
import type { FillDraftReason } from "./types.ts";

/** A written answer the agent entered, kept as a pending field until the candidate reviews it. */
export interface DraftEntry { label: string; reason: FillDraftReason; answer: string; evidence: string[] }

const RESTRICTED = new RegExp(`\\b(${[
  "salary", "salario", "salarial", "compensation", "remuneracao", "pretensao",
  "work authori[sz]ation", "authori[sz]ed to work", "right to work", "autorizacao de trabalho", "autorizado a trabalhar", "sponsorship", "visa", "visto de trabalho",
  "privacy policy", "politica de privacidade", "terms of use", "terms of service", "termos de uso", "termos e condicoes", "i agree", "i accept", "li e aceito", "concordo", "consent", "consentimento",
  "years of experience", "how many years", "anos de experiencia", "quantos anos",
  "criminal", "antecedentes", "gender", "genero", "disability", "deficiencia", "ethnicity", "raca", "etnia", "veteran", "sexual orientation", "orientacao sexual", "pronouns", "pronomes",
  "cpf", "passport", "passaporte", "social security",
].join("|")})\\b`);
/** Quotes shorter than this many characters prove nothing and are ignored. */
const MIN_QUOTE = 8;
const MAX_ANSWER = 5000;

type Entry = Record<string, unknown>;
const record = (value: unknown): Entry => value && typeof value === "object" ? value as Entry : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

/** Questions only the candidate may answer, whatever the agent wrote. */
function restricted(label: string): boolean {
  const key = matchLabels([label], { answers: {} }).unfilled[0]?.key;
  const category = key ? KEY_BY_NAME.get(key)?.category : undefined;
  return category === "eligibility" || category === "eeo" || RESTRICTED.test(normalize(label));
}

const comparable = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}

/** Each text of the evidence file, also with the PDF's line-end hyphenation joined; empty when unreadable. */
function corpus(contextPath: string | undefined): string[] {
  if (!contextPath) return [];
  try {
    return strings(JSON.parse(readFileSync(contextPath, "utf8")))
      .flatMap(value => [value, value.replace(/-[ \t]*\r?\n\s*/g, "")]).map(value => ` ${comparable(value)} `);
  } catch { return []; }
}

/** Every quote must be in the evidence, and at least one must be a phrase rather than a single term. */
function supported(quotes: string[], evidence: string[]): boolean {
  const normalized = quotes.map(comparable);
  return normalized.some(quote => quote.split(" ").length >= 3)
    && normalized.every(quote => quote.length >= MIN_QUOTE && evidence.some(source => source.includes(` ${quote} `)));
}

function assess(entry: Entry, evidence: () => string[]): DraftEntry | Entry {
  const label = text(entry.label);
  const answer = text(entry.answer).slice(0, MAX_ANSWER);
  if (!answer) return { label, reason: "no-evidence" };
  const quotes = Array.isArray(entry.evidence) ? entry.evidence.map(text).filter(Boolean) : [];
  const reason: FillDraftReason = restricted(label) ? "ai-draft-restricted"
    : entry.basis === "general" ? "ai-draft-general"
      : supported(quotes, evidence()) ? "ai-draft" : "ai-draft-unverified";
  return { label, reason, answer, evidence: quotes };
}

const claimsDraft = (entry: unknown): boolean => text(record(entry).reason || record(entry).skip).startsWith("ai-draft");

/**
 * Turn the agent's drafted answers into pending fields. The reason is decided
 * here, never by the agent: restricted questions are flagged, and a claim about
 * the candidate counts as supported only when its quotes are in the evidence
 * file. A drafted field is never also reported as filled.
 */
export function reviewDrafts(fields: Entry, unfilled: unknown[], drafted: unknown[], contextPath?: string): { fields: Entry; unfilled: unknown[] } {
  const drafts = [...drafted, ...unfilled.filter(claimsDraft)].map(record).filter(entry => text(entry.label));
  if (!drafts.length) return { fields, unfilled: unfilled.filter(entry => !claimsDraft(entry)) };
  let cached: string[] | undefined;
  const evidence = () => cached ??= corpus(contextPath);
  const labels = new Set(drafts.map(entry => text(entry.label)));
  return {
    fields: Object.fromEntries(Object.entries(fields).filter(([key]) => !labels.has(key))),
    unfilled: [...unfilled.filter(entry => !claimsDraft(entry) && !labels.has(text(record(entry).label))), ...drafts.map(entry => assess(entry, evidence))],
  };
}
