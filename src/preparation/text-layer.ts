import type { Finding } from "./layout/findings.ts";

/** The candidate's contact details, read from the default applicant answers. */
export interface Identity { email?: string; phone?: string }

/**
 * Typographic substitutions LaTeX makes from plain source text, folded back for
 * comparison only: `'` becomes U+2019, `--` U+2013, `~` a no-break space.
 */
const FOLDS: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201c": "\"", "\u201d": "\"",
  "\u2013": "-", "\u2014": "-", "\u00a0": " ",
};
/** Fold a string for comparison: NFC (pdflatex may store accents decomposed), typography, whitespace. */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u00a0]/g, char => FOLDS[char]!).split(/\s+/).filter(Boolean).join(" ");
}

/** Dashes a year must never be joined to: an ATS that splits ranges on U+002D drops the date. */
const DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212";
const YEAR = "(?<!\\d)(?:19|20)\\d{2}(?!\\d)";
// Horizontal whitespace only, so a year ending one line is not joined to a dash opening the next.
const DATE_RANGE = new RegExp(`${YEAR}[^\\S\\n]*[${DASHES}]|[${DASHES}][^\\S\\n]*${YEAR}`, "g");
const TOKEN_BEFORE = /(\S+)[^\S\n]*$/;
const TOKEN_AFTER = /^[^\S\n]*(\S+)/;
const BARE_NUMBER = /^\d+(?:[.,]\d+)*[kKmM%]?$/;
const BARE_YEAR = /^(?:19|20)\d{2}$/;
const OUTER_PUNCTUATION = ".,;:!?()[]{}\"'";

function strip(token: string): string {
  let start = 0, end = token.length;
  while (start < end && OUTER_PUNCTUATION.includes(token[start]!)) start++;
  while (end > start && OUTER_PUNCTUATION.includes(token[end - 1]!)) end--;
  return token.slice(start, end);
}
/** A bare number; a dotted group holding a year (`01.2016`) is a numeric date, not a quantity. */
function bareNumber(token: string): string | undefined {
  const core = strip(token);
  if (!BARE_NUMBER.test(core)) return undefined;
  const groups = core.replace(/[kKmM%]+$/, "").split(/[.,]/);
  return groups.length > 1 && groups.some(group => BARE_YEAR.test(group)) ? undefined : core;
}
/** A numeric amount with an attached currency symbol. */
function currencyAmount(token: string): string | undefined {
  const core = strip(token);
  const amount = /^\p{Sc}/u.test(core) ? core.slice(1) : /\p{Sc}$/u.test(core) ? core.slice(0, -1) : undefined;
  return amount !== undefined && BARE_NUMBER.test(amount) ? amount : undefined;
}
/** Both sides are bare numbers and not a year pair (`2016-2024`, `2016-17`): a quantity range. */
function quantityRange(line: string, dash: number): boolean {
  const before = TOKEN_BEFORE.exec(line.slice(0, dash))?.[1];
  const after = TOKEN_AFTER.exec(line.slice(dash + 1))?.[1];
  if (!before || !after) return false;
  const [leftMoney, rightMoney] = [currencyAmount(before), currencyAmount(after)];
  const left = leftMoney ?? bareNumber(before), right = rightMoney ?? bareNumber(after);
  if (leftMoney !== undefined || rightMoney !== undefined) return left !== undefined && right !== undefined;
  if (left === undefined || right === undefined) return false;
  return !(BARE_YEAR.test(left) && (BARE_YEAR.test(right) || /^\d{2}$/.test(right)));
}

/** Every year joined to a non-ASCII dash in the raw text layer, in document order. */
export function findNonAsciiDateRanges(text: string): { line: string; dash: string }[] {
  const hits: { line: string; dash: string }[] = [];
  for (const match of text.matchAll(DATE_RANGE)) {
    const offset = [...match[0]].findIndex(char => DASHES.includes(char));
    const dash = match[0][offset]!;
    const start = text.lastIndexOf("\n", match.index) + 1;
    const end = text.indexOf("\n", match.index + match[0].length);
    const line = text.slice(start, end === -1 ? text.length : end);
    if (!quantityRange(line, match.index + offset - start)) hits.push({ line: line.split(/\s+/).filter(Boolean).join(" "), dash });
  }
  return hits;
}

const codePoint = (char: string) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
const sample = (items: string[]) => [...new Set(items)].slice(0, 3).join(", ");
const digits = (value: string) => value.replace(/\D/g, "");

/** The phone's digits, with or without a country code of up to three digits, ignoring formatting. */
function containsPhone(text: string, phone: string): boolean {
  if (normalizeText(text).includes(normalizeText(phone))) return true;
  const number = digits(phone);
  const layer = text.replace(/[\s().+\-\u2010-\u2015\u00a0]/g, "");
  for (let skip = 0; skip <= 3 && number.length - skip >= 8; skip++) if (layer.includes(number.slice(skip))) return true;
  return false;
}

function glyphFindings(text: string): Finding[] {
  const privateUse = text.match(/[\ue000-\uf8ff]/g) ?? [];
  const replacement = text.match(/\ufffd/g) ?? [];
  return [
    ...privateUse.length ? [{ code: "private-use", message: `The text layer has ${privateUse.length} private-use glyph(s) (${sample(privateUse.map(codePoint))}), usually font icons that an ATS cannot read.` }] : [],
    ...replacement.length ? [{ code: "replacement", message: `The text layer has ${replacement.length} replacement character(s) (U+FFFD): some text could not be extracted.` }] : [],
  ];
}

function identityFindings(text: string, { email, phone }: Identity): Finding[] {
  const findings: Finding[] = [];
  if (email?.trim() && !normalizeText(text).toLowerCase().includes(normalizeText(email).toLowerCase()))
    findings.push({ code: "missing-email", message: `The text layer does not contain your email (${email.trim()}) as text.` });
  if (phone?.trim() && digits(phone).length && !containsPhone(text, phone))
    findings.push({ code: "missing-phone", message: `The text layer does not contain your phone (${phone.trim()}) as text.` });
  return findings;
}

function dateFindings(text: string): Finding[] {
  const byDash = new Map<string, string[]>();
  for (const hit of findNonAsciiDateRanges(text)) byDash.set(hit.dash, [...byDash.get(hit.dash) ?? [], hit.line]);
  return [...byDash].map(([dash, lines]) => ({
    code: `date-dash:${codePoint(dash)}`,
    message: `${lines.length === 1 ? "A date range uses" : `${lines.length} date ranges use`} a non-ASCII dash (${codePoint(dash)} in ${lines.slice(0, 2).map(line => `\u201c${line.slice(0, 80)}\u201d`).join(", ")}); some ATS, such as Workday, drop these dates. Use an ASCII hyphen.`,
  }));
}

/** What an ATS reads: unreadable glyphs, missing contact details and dates joined by non-ASCII dashes. */
export function textLayerFindings(text: string, identity: Identity = {}): Finding[] {
  return [...glyphFindings(text), ...identityFindings(text, identity), ...dateFindings(text)];
}
export function textLayerWarnings(text: string, identity: Identity = {}): string[] {
  return textLayerFindings(text, identity).map(finding => finding.message);
}
