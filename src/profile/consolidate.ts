import { createHash } from "node:crypto";
import { monthIndex } from "./linkedin/dates.ts";
import type { ChoiceSource, LinkedInProfile, ProfileConflict, ProfileSources } from "./types.ts";

type Data = Record<string, unknown>;
/** An entry of either source reduced to what is matched and compared. */
type Entry = { name: string; title: string; start: string; end: string; location: string };

const LEGAL = new Set(["ltda", "ltd", "lda", "inc", "llc", "sa", "me", "eireli", "corp", "corporation", "co", "gmbh", "limited", "plc", "ag", "bv", "srl"]);
/**
 * Identity tokens of a company or school: lowercase, no accents, punctuation,
 * legal suffixes or text in parentheses or after " - ".
 */
export function nameTokens(name: string): string[] {
  const plain = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\([^)]*\)/g, " ").split(/\s[-–—|]\s/)[0]!
    .replace(/\bs\/a\b/g, "sa").replace(/\./g, "");
  const tokens = plain.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = tokens.filter(token => !LEGAL.has(token));
  return kept.length ? kept : tokens;
}
/** Jaccard similarity of at least 0.5, or one name contained in the other. */
export function similarNames(a: string, b: string): boolean {
  const left = new Set(nameTokens(a));
  const right = new Set(nameTokens(b));
  if (!left.size || !right.size) return false;
  const shared = [...left].filter(token => right.has(token)).length;
  return shared / (left.size + right.size - shared) >= 0.5 || shared === Math.min(left.size, right.size);
}

/** A source date as `YYYY-MM`, `YYYY` or `Present`; "" when absent or unreadable. */
export function profileDate(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (/^(?:present|current|now|atual|presente|o momento)$/i.test(text)) return "Present";
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}`;
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (slash) return `${slash[2]}-${slash[1]!.padStart(2, "0")}`;
  return /^\d{4}$/.test(text) ? text : "";
}
/** Equal at the precision both sources have: a year alone matches any month of that year. */
export function sameDate(a: string, b: string): boolean {
  if (a === "Present" || b === "Present") return a === b;
  return a.slice(0, 4) === b.slice(0, 4) && (a.length === 4 || b.length === 4 || a === b);
}
const plain = (text: string) => nameTokens(text).join(" ");
const sameLocation = (a: string, b: string) => plain(a).includes(plain(b)) || plain(b).includes(plain(a));

function span(entry: Entry): [number, number] {
  const from = monthIndex(entry.start) ?? -Infinity;
  const end = entry.end === "Present" || !entry.end ? Infinity : monthIndex(entry.end)! + (entry.end.length === 4 ? 11 : 0);
  return [from, end];
}
const overlaps = (a: Entry, b: Entry) => { const [af, at] = span(a); const [bf, bt] = span(b); return af <= bt && bf <= at; };
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const later = (a: string, b: string) => (a === "Present" || b === "Present" ? "Present" : (monthIndex(a) ?? -1) >= (monthIndex(b) ?? -1) ? a : b);

/** Several roles at one company compared with a single data entry: their earliest start and latest end. */
function aggregate(entries: Entry[]): Entry {
  const starts = entries.map(entry => entry.start).filter(Boolean).sort((a, b) => monthIndex(a)! - monthIndex(b)!);
  return { ...entries[0]!, start: starts[0] ?? "", end: entries.map(entry => entry.end).reduce(later), location: entries.find(entry => entry.location)?.location ?? "" };
}
/** The LinkedIn entries matching one data entry: same name, overlapping period and, when both have one, the same title. */
function matches(entry: Entry, candidates: Entry[], free: Set<number>): number[] {
  const found = candidates.flatMap((candidate, index) => (free.has(index) && similarNames(entry.name, candidate.name) && overlaps(entry, candidate) ? [index] : []));
  const titled = entry.title ? found.filter(index => similarNames(entry.title, candidates[index]!.title)) : [];
  return titled.length ? titled.slice(0, 1) : found;
}

const LABELS: Record<string, string> = { start: "start date", end: "end date", location: "location" };
type Section = { name: "work" | "education"; data: Entry[]; linkedin: Entry[] };
function compare(section: Section, choices: Map<string, ChoiceSource>, matched: Set<number>): ProfileConflict[] {
  const free = new Set(section.linkedin.map((_, index) => index));
  return section.data.flatMap(entry => {
    const found = matches(entry, section.linkedin, free);
    if (!found.length) return [];
    found.forEach(index => { free.delete(index); matched.add(index); });
    const other = aggregate(found.map(index => section.linkedin[index]!));
    const identity = [section.name, plain(entry.name), ...found.map(index => plain(section.linkedin[index]!.title))].join(":");
    return (["start", "end", "location"] as const).flatMap(field => {
      const values = { data: entry[field], linkedin: other[field] };
      if (!values.data || !values.linkedin || (field === "location" ? sameLocation(values.data, values.linkedin) : sameDate(values.data, values.linkedin))) return [];
      const key = createHash("sha256").update(JSON.stringify([`${section.name}.${field}`, identity, values.data, values.linkedin])).digest("hex");
      const label = `${[entry.name, entry.title].filter(Boolean).join(" · ")}: ${LABELS[field]}`;
      return [{ key, field: `${section.name}.${field}`, label, values, chosen: choices.get(key) ?? null }];
    });
  });
}

const entries = (value: unknown, name: string): Data[] => (Array.isArray(value) ? value.filter((item): item is Data => !!item && typeof item === "object" && !!text((item as Data)[name])) : []);
const dataEntry = (item: Data, name: string, title: string): Entry => ({ name: text(item[name]), title: text(item[title]), start: profileDate(item.start), end: profileDate(item.end), location: text(item.location) });

/**
 * Add the LinkedIn export and the reference resumes to the data file as
 * evidence. The data keys stay unchanged; everything new is under
 * `profileSources`. Without any PDF evidence the data is returned as is.
 */
export function consolidateProfile(data: Data | null, linkedin: LinkedInProfile | null, references: { file: string; text: string }[], choices: Map<string, ChoiceSource>): Data | null {
  if (!linkedin && !references.length) return data;
  const matched = new Set<number>();
  const conflicts = linkedin ? [
    ...compare({ name: "work", data: entries(data?.work, "company").map(item => dataEntry(item, "company", "title")), linkedin: linkedin.experience.map(role => ({ ...role, name: role.company })) }, choices, matched),
    ...compare({ name: "education", data: entries(data?.education, "school").map(item => dataEntry(item, "school", "degree")), linkedin: linkedin.education.map(item => ({ name: item.school, title: "", start: item.start, end: item.end, location: "" })) }, choices, new Set()),
  ] : [];
  const resolved = conflicts.flatMap(conflict => (conflict.chosen ? [{ key: conflict.key, field: conflict.field, label: conflict.label, source: conflict.chosen, value: conflict.values[conflict.chosen] }] : []));
  const profileSources: ProfileSources = { linkedin, linkedinOnly: linkedin ? linkedin.experience.filter((_, index) => !matched.has(index)) : [], references, conflicts, resolved };
  return { ...data, profileSources };
}
