import { validateAnswer } from "../answers/catalog.ts";
import { EMPTY_CONTACT, profileUrl, webAddress } from "./linkedin/contact.ts";
import type { LinkedInProfile, PersonalField, PersonalKey, PersonalSource, ProfileAbout } from "./types.ts";

type Data = Record<string, unknown>;
/** Answer keys a resume can provide, in the order Profile shows them. */
export const PERSONAL_KEYS: readonly PersonalKey[] = ["first_name", "last_name", "full_name", "email", "phone", "location", "linkedin_url", "github_url", "portfolio_url"];
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
    ...nameParts(text(data.name)), email: text(contact.email), phone: text(contact.tel) || text(contact.phone), location,
    linkedin_url: social(data, "linkedin"), github_url: social(data, "github"), portfolio_url: webAddress(text(data.personalWebsiteUrl)),
  };
}
function fromLinkedIn(profile: LinkedInProfile | null): Values {
  if (!profile) return {};
  const contact = profile.contact ?? EMPTY_CONTACT;
  return { ...nameParts(text(profile.name)), email: contact.email, phone: contact.phone, location: profile.location, linkedin_url: contact.linkedin, github_url: contact.github, portfolio_url: contact.website };
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
  return PERSONAL_KEYS.flatMap(key => {
    for (const [source, values] of sources) {
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
