import { profileDate } from "./dates.ts";
import { monthIndex } from "./linkedin/dates.ts";
import type { ProfileResume, ResumeEntry } from "./types.ts";

type Data = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const objects = (value: unknown): Data[] => (Array.isArray(value) ? value.filter((item): item is Data => !!item && typeof item === "object") : []);
const hidden = (item: Data) => (item.hidden === true ? { hidden: true } : {});

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
  skills: strings(item.techStack), ...hidden(item),
});
const course = (item: Data): ResumeEntry => ({
  title: text(item.degree) || [text(item.studyType), text(item.area)].filter(Boolean).join(" · "), organization: text(item.school) || text(item.institution),
  start: profileDate(item.start ?? item.startDate), end: profileDate(item.end ?? item.endDate), location: text(item.location), bullets: [], skills: [], ...hidden(item),
});

/** The candidate's experience and education as the profile lists them; nothing is written. */
export function profileResume(data: Data | null): ProfileResume {
  const named = (entry: ResumeEntry) => !!(entry.organization || entry.title);
  return {
    experience: newestFirst(objects(data?.work).map(work).filter(named)),
    education: newestFirst(objects(data?.education).map(course).filter(named)),
  };
}
