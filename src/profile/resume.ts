import { profileDate, sameDate, similarNames } from "./consolidate.ts";
import { monthIndex } from "./linkedin/dates.ts";
import type { LinkedInProfile, ProfileConflict, ProfileResume, ResumeEntry } from "./types.ts";

type Data = Record<string, unknown>;
type Section = "work" | "education";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const objects = (value: unknown): Data[] => (Array.isArray(value) ? value.filter((item): item is Data => !!item && typeof item === "object") : []);

function span(entry: ResumeEntry): [number, number] {
  const from = monthIndex(entry.start) ?? -Infinity;
  const end = entry.end === "Present" || !entry.end ? Infinity : (monthIndex(entry.end) ?? Infinity) + (entry.end.length === 4 ? 11 : 0);
  return [from, end];
}
const overlaps = (a: ResumeEntry, b: ResumeEntry) => { const [af, at] = span(a); const [bf, bt] = span(b); return af <= bt && bf <= at; };

/**
 * The LinkedIn entry describing the same role or course: the same organization
 * and, when both have one, a similar title; the same start wins over an overlap.
 */
function counterpart(entry: ResumeEntry, candidates: ResumeEntry[], used: Set<number>): number {
  const found = candidates.flatMap((candidate, index) => (!used.has(index) && similarNames(entry.organization, candidate.organization)
    && (!entry.title || !candidate.title || similarNames(entry.title, candidate.title)) && overlaps(entry, candidate) ? [index] : []));
  return found.find(index => entry.start && sameDate(entry.start, candidates[index]!.start)) ?? found[0] ?? -1;
}

/** A decided conflict replaces the data file's value; an undecided one keeps it, as the base resume does. */
function decided(section: Section, entry: ResumeEntry, conflicts: ProfileConflict[]): ResumeEntry {
  const pick = (field: "start" | "end" | "location") => {
    const conflict = conflicts.find(item => item.chosen && item.field === `${section}.${field}` && item.values.data === entry[field] && item.label.startsWith(entry.organization));
    return conflict?.chosen ? conflict.values[conflict.chosen] : entry[field];
  };
  return { ...entry, start: pick("start"), end: pick("end"), location: pick("location") };
}

const words = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3);
/**
 * A data entry with only a company and dates still describes a LinkedIn role
 * when they overlap and a distinctive word of its name, such as "UFU" or
 * "X-RAT", appears in the role's organization, title or bullets.
 */
function mentioned(entry: ResumeEntry, candidate: ResumeEntry): boolean {
  if (entry.title || !overlaps(entry, candidate)) return false;
  const text = new Set(words([candidate.organization, candidate.title, candidate.location, ...candidate.bullets].join(" ")));
  return words(entry.organization).some(word => text.has(word));
}
function find(entry: ResumeEntry, candidates: ResumeEntry[], excluded: Set<number>): number {
  const strong = counterpart(entry, candidates, excluded);
  return strong >= 0 ? strong : candidates.findIndex((candidate, index) => !excluded.has(index) && mentioned(entry, candidate));
}

/** Data entries completed by their LinkedIn role; a second data entry for a role already shown is left out. */
function merge(section: Section, data: ResumeEntry[], linkedin: ResumeEntry[], conflicts: ProfileConflict[]): ResumeEntry[] {
  const used = new Set<number>();
  const free = (excluded: Set<number>) => new Set(linkedin.map((_, index) => index).filter(index => !excluded.has(index)));
  const merged = data.flatMap(entry => {
    const index = find(entry, linkedin, used);
    if (index < 0) return !entry.title && find(entry, linkedin, free(used)) >= 0 ? [] : [entry];
    used.add(index);
    const other = linkedin[index]!;
    return [decided(section, {
      ...entry, title: entry.title || other.title, location: entry.location || other.location,
      start: preciser(entry.start, other.start), end: preciser(entry.end, other.end),
      bullets: entry.bullets.length ? entry.bullets : other.bullets, skills: entry.skills.length ? entry.skills : other.skills, source: "both",
    }, conflicts)];
  });
  return [...merged, ...linkedin.filter((_, index) => !used.has(index))];
}
/** The data file's date, unless it is only the year of the LinkedIn date. */
const preciser = (data: string, linkedin: string) => (!data || data.length === 4 && linkedin.startsWith(data) ? linkedin || data : data);

/** Most recent first: current roles, then by start; entries without dates keep their order at the end. */
function newestFirst(entries: ResumeEntry[]): ResumeEntry[] {
  const key = (entry: ResumeEntry) => [entry.end === "Present" ? 1 : 0, monthIndex(entry.start) ?? -Infinity] as const;
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
    const [ac, as] = key(a.entry); const [bc, bs] = key(b.entry);
    return bc - ac || bs - as || a.index - b.index;
  }).map(item => item.entry);
}

const work = (item: Data): ResumeEntry => ({
  title: text(item.title) || text(item.position), organization: text(item.company) || text(item.name), start: profileDate(item.start ?? item.startDate),
  end: profileDate(item.end ?? item.endDate), location: text(item.location), bullets: strings(item.highlights).length ? strings(item.highlights) : strings([item.description ?? item.summary]),
  skills: strings(item.techStack), source: "data",
});
const course = (item: Data): ResumeEntry => ({
  title: text(item.degree) || [text(item.studyType), text(item.area)].filter(Boolean).join(" · "), organization: text(item.school) || text(item.institution),
  start: profileDate(item.start ?? item.startDate), end: profileDate(item.end ?? item.endDate), location: text(item.location), bullets: [], skills: [], source: "data",
});

/**
 * The candidate's experience and education to read: the data file's entries,
 * completed by the LinkedIn export where both describe the same role, and the
 * roles only LinkedIn has. Decided conflicts are applied; nothing is written.
 */
export function profileResume(data: Data | null, linkedin: LinkedInProfile | null, conflicts: ProfileConflict[]): ProfileResume {
  const roles: ResumeEntry[] = (linkedin?.experience ?? []).map(role => ({
    title: text(role.title), organization: text(role.company), start: profileDate(role.start), end: profileDate(role.end), location: text(role.location), bullets: strings(role.bullets), skills: [], source: "linkedin",
  }));
  const courses: ResumeEntry[] = (linkedin?.education ?? []).map(item => ({
    title: text(item.degree), organization: text(item.school), start: profileDate(item.start), end: profileDate(item.end), location: "", bullets: [], skills: [], source: "linkedin",
  }));
  const named = (entry: ResumeEntry) => !!(entry.organization || entry.title);
  return {
    experience: newestFirst(merge("work", objects(data?.work).map(work).filter(named), roles.filter(named), conflicts)),
    education: newestFirst(merge("education", objects(data?.education).map(course).filter(named), courses.filter(named), conflicts)),
  };
}
