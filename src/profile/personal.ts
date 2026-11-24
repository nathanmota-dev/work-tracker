import { validateAnswer } from "../answers/catalog.ts";
import { EMPTY_CONTACT, profileUrl, webAddress } from "./linkedin/contact.ts";
import type { LinkedInProfile, PersonalField, PersonalKey, PersonalSource, ProfileAbout } from "./types.ts";

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
function fromLinkedIn(profile: LinkedInProfile | null): Values {
  if (!profile) return {};
  const contact = profile.contact ?? EMPTY_CONTACT;
  return { ...nameParts(text(profile.name)), email: contact.email, phone: contact.phone, location: profile.location, ...placeParts(profile.location), summary: profile.summary, languages: languageList(profile.languages), linkedin_url: contact.linkedin, github_url: contact.github, portfolio_url: contact.website };
}
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
 * The personal details every source provides, each from the first source that
 * has a valid value: the data file the user edits, then the LinkedIn export,
 * then the other resume PDFs. Invalid values are never suggested.
 */
export function personalFromSources(data: Data | null, linkedin: LinkedInProfile | null, references: { text: string }[]): PersonalField[] {
  const sources: [PersonalSource, Values][] = [["data", fromData(data)], ["linkedin", fromLinkedIn(linkedin)], ...references.map(reference => ["resume", fromResumeText(reference.text)] as [PersonalSource, Values])];
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

/** Read-only summary of the profile: from LinkedIn when it was imported, skills also from the data file. */
export function aboutFromSources(data: Data | null, linkedin: LinkedInProfile | null): ProfileAbout | null {
  const skills = [...new Set([...(linkedin?.topSkills ?? []), ...strings(data?.techStack), ...strings(data?.skills)])];
  const about: ProfileAbout = {
    headline: linkedin?.headline ?? "", summary: linkedin?.summary ?? "", currentCompany: linkedin?.experience.find(role => role.end === "Present")?.company ?? "",
    skills, languages: linkedin?.languages ?? [], certifications: linkedin?.certifications ?? [],
  };
  return about.headline || about.summary || skills.length || about.languages.length || about.certifications.length ? about : null;
}
