import { validateAnswer } from "../answers/catalog.ts";
import { profileUrl, webAddress } from "./linkedin/contact.ts";
import type { PersonalField, PersonalKey, PersonalSource, ProfileAbout, StructuredSource } from "./types.ts";

type Data = Record<string, unknown>;
/** Answer keys a resume can provide, in the order Profile shows them. */
export const PERSONAL_KEYS: readonly PersonalKey[] = ["first_name", "last_name", "full_name", "email", "phone", "location", "city", "state", "country", "summary", "languages", "linkedin_url", "github_url", "portfolio_url"];
const PLACE_KEYS = new Set<PersonalKey>(["city", "state", "country"]);
type Values = Partial<Record<PersonalKey, string>>;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(item => (typeof item === "string" ? item.trim() : text((item as Data | null)?.name))).filter(Boolean) : []);
function nameParts(full: string): Values {
  const words = full.split(/\s+/).filter(Boolean);
  return words.length < 2 ? {} : { full_name: words.join(" "), first_name: words[0], last_name: words.slice(1).join(" ") };
}
/** The place of a Google Maps link, such as `.../maps/place/Ribeir%C3%A3o+Preto+-+SP`. */
function mapsPlace(link: string): string {
  const match = /\/maps\/place\/([^/?#]+)/.exec(link);
  if (!match) return "";
  try { return decodeURIComponent(match[1]!.replace(/\+/g, " ")).trim(); }
  catch { return ""; }
}
/**
 * City, state and country of a location line: "City, State, Country" (LinkedIn),
 * "City - UF" (Google Maps) or "City, UF". Parts that cannot be told apart are left out.
 */
export function placeParts(location: string): Values {
  const value = (location ?? "").trim();
  const dashed = /^(.+?)\s+-\s+([^,-]+)$/.exec(value);
  if (dashed) return { city: dashed[1]!.trim(), state: dashed[2]!.trim().replace(/^State of\s+/i, "") };
  const parts = value.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length >= 3) return { city: parts[0], state: parts[1], country: parts[parts.length - 1] };
  if (parts.length === 2) return /^[A-Z]{2}$/.test(parts[1]!) ? { city: parts[0], state: parts[1] } : { city: parts[0], country: parts[1] };
  return {};
}
function social(data: Data, host: "linkedin" | "github"): string {
  const links = Array.isArray((data.contact as Data | undefined)?.social) ? (data.contact as { social: Data[] }).social : [];
  return links.map(link => profileUrl(text(link?.url), host)).find(Boolean) ?? "";
}

/** What the resume data file says: `name`, `contact.email/tel/social`, `location` or `locationLink`, `personalWebsiteUrl`. */
function fromData(data: Data | null): Values {
  if (!data) return {};
  const contact = (data.contact ?? {}) as Data;
  const location = text(data.location) || text((data.location as Data | undefined)?.city) || mapsPlace(text(data.locationLink));
  return {
    ...nameParts(text(data.name)), email: text(contact.email), phone: text(contact.tel) || text(contact.phone), location, ...placeParts(location), summary: text(data.summary) || text(data.about),
    languages: languageList(data.languages),
    linkedin_url: social(data, "linkedin"), github_url: social(data, "github"), portfolio_url: webAddress(text(data.personalWebsiteUrl)),
  };
}
const languageList = (value: unknown): string => (Array.isArray(value) ? value.map(item => typeof item === "string" ? item.trim() : [text((item as Data | null)?.name), text((item as Data | null)?.level)].filter(Boolean).join(" · ")).filter(Boolean).join(", ") : "");
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}\b/;
/** Contact details of a resume PDF's header: only its first lines, so dates and numbers further down are ignored. */
export function fromResumeText(value: string): Values {
  const header = value.split("\n").slice(0, 15).join("\n");
  return {
    email: /[^\s@|,;()]+@[^\s@|,;()]+\.[a-z]{2,}/i.exec(header)?.[0] ?? "",
    phone: PHONE.exec(header)?.[0]?.trim() ?? "",
    linkedin_url: profileUrl(header, "linkedin"), github_url: profileUrl(header, "github"),
  };
}

/**
 * The personal details the profile provides, each from the first source that
 * has a valid value: the structured source (the data file or the LinkedIn
 * export, in the data file's shape), then the other resume PDFs. Invalid
 * values are never suggested.
 */
export function personalFromSources(data: Data | null, kind: StructuredSource["kind"] | null, references: { text: string }[]): PersonalField[] {
  const sources: [PersonalSource, Values][] = [...(data && kind ? [[kind, fromData(data)] as [PersonalSource, Values]] : []), ...references.map(reference => ["resume", fromResumeText(reference.text)] as [PersonalSource, Values])];
  // City, state and country describe one place: they come from the source that gave `location`, never a mix.
  const located = sources.find(([, values]) => { const value = values.location?.trim(); return value && !validateAnswer("location", value); });
  return PERSONAL_KEYS.flatMap(key => {
    for (const [source, values] of PLACE_KEYS.has(key) ? (located ? [located] : []) : sources) {
      const value = values[key]?.trim();
      if (value && !validateAnswer(key, value)) return [{ key, value, source }];
    }
    return [];
  });
}

const languages = (value: unknown) => (Array.isArray(value) ? value.flatMap(item => (typeof item === "string" ? (item.trim() ? [{ name: item.trim(), level: "" }] : []) : text((item as Data | null)?.name) ? [{ name: text((item as Data).name), level: text((item as Data).level) }] : [])) : []);
const groupItems = (value: unknown) => (Array.isArray(value) ? value.flatMap(group => strings((group as Data | null)?.items)) : []);

/** Read-only summary of the profile: headline, summary, current company, skills, languages and certifications. */
export function aboutFromSources(data: Data | null): ProfileAbout | null {
  if (!data) return null;
  const current = Array.isArray(data.work) ? (data.work as Data[]).find(role => text(role?.end).toLowerCase() === "present") : undefined;
  const about: ProfileAbout = {
    headline: text(data.headline), summary: text(data.summary), currentCompany: text(current?.company),
    skills: [...new Set([...groupItems(data.skillGroups), ...strings(data.skills), ...strings(data.techStack)])], languages: languages(data.languages), certifications: strings(data.certifications),
  };
  return about.headline || about.summary || about.skills.length || about.languages.length || about.certifications.length ? about : null;
}
