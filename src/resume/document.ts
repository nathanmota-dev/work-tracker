import { profileDate } from "../profile/dates.ts";

export interface ResumeSkillGroup { name: string; items: string[] }
/** What the base resume shows, already in reading order; hidden entries are left out. */
export interface ResumeDocument {
  name: string;
  /** Location, phone and e-mail. */
  contact: { location: string; phone: string; email: string };
  /** LinkedIn, GitHub, website and other profiles, in the order the source lists them. */
  links: string[];
  summary: string;
  education: { school: string; location: string; degree: string; start: string; end: string }[];
  /** Grouped skills; a source without groups gives one group with an empty name. */
  skills: ResumeSkillGroup[];
  work: { company: string; title: string; start: string; end: string; detail: string; highlights: string[] }[];
  projects: { name: string; description: string; date: string; techStack: string[]; highlights: string[] }[];
  certifications: string[];
}

type Data = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);
const objects = (value: unknown): Data[] => (Array.isArray(value) ? value.filter((item): item is Data => !!item && typeof item === "object" && !Array.isArray(item)) : []);
/** Entries the base resume shows: `hidden: true` keeps one as evidence for tailoring only. */
const shown = (value: unknown) => objects(value).filter(item => item.hidden !== true);
const link = (value: unknown) => { const url = text(value); return /^(?:https?:\/\/|mailto:)/i.test(url) ? url : ""; };
const highlights = (item: Data) => { const list = strings(item.highlights); return list.length ? list : strings([item.description]); };

function skills(data: Data): ResumeSkillGroup[] {
  const groups = objects(data.skillGroups).map(group => ({ name: text(group.name), items: strings(group.items) })).filter(group => group.items.length);
  if (groups.length) return groups;
  const flat = strings(data.skills);
  return flat.length ? [{ name: "", items: flat }] : [];
}

/** The base resume of a resume data file, with its texts exactly as written. */
export function documentFromData(data: Data): ResumeDocument {
  const contact = (data.contact && typeof data.contact === "object" ? data.contact : {}) as Data;
  return {
    name: text(data.name),
    contact: { location: text(data.location), phone: text(contact.tel) || text(contact.phone), email: text(contact.email) },
    links: [...objects(contact.social).map(item => link(item.url)), link(data.personalWebsiteUrl)].filter(Boolean),
    summary: text(data.summary),
    education: shown(data.education).map(item => ({ school: text(item.school), location: text(item.location), degree: text(item.degree), start: profileDate(item.start), end: profileDate(item.end) })),
    skills: skills(data),
    work: shown(data.work).map(item => ({ company: text(item.company), title: text(item.title), start: profileDate(item.start), end: profileDate(item.end), detail: strings(item.techStack).join(", ") || text(item.location), highlights: strings(item.highlights) })),
    projects: shown(data.projects).map(item => ({ name: text(item.name), description: projectSubtitle(item), date: profileDate(item.date), techStack: strings(item.techStack), highlights: highlights(item) })),
    certifications: strings(data.certifications),
  };
}
/** The project's subtitle: its description when bullets describe it, nothing when the description is the only text. */
function projectSubtitle(item: Data): string {
  return strings(item.highlights).length ? text(item.description) : "";
}
