import { z } from "zod";
import { KEY_SPECS, type Category } from "../match/synonyms";

export const CATEGORY_LABELS: Record<Category, string> = {
  contact: "Identity and contact", eligibility: "Eligibility", profile: "Professional profile", links: "Links",
  eeo: "Human review", custom: "Custom",
};
const LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", full_name: "Full name",
  email: "Email", phone: "Phone", location: "Location",
  work_authorization: "Work authorization", requires_sponsorship: "Requires sponsorship",
  salary_expectation: "Salary expectation", notice_period: "Notice period",
  birth_date: "Birth date", country: "Country", state: "State / region", city: "City", neighborhood: "Neighborhood",
  address: "Street address", postal_code: "Postal code (CEP)", desired_role: "Desired role", experience_level: "Experience level",
  professional_category: "Professional category", summary: "Professional summary", languages: "Languages",
  accepts_clt: "Accepts CLT hiring", preferred_locations: "Preferred locations", social_links: "Other social links",
  linkedin_url: "LinkedIn profile", github_url: "GitHub profile", portfolio_url: "Portfolio website",
  eeo_gender: "Gender", eeo_race: "Race / ethnicity", eeo_veteran: "Veteran status", eeo_disability: "Disability status",
};
export const ANSWER_CATALOG = KEY_SPECS.map((spec) => ({
  key: spec.key, label: LABELS[spec.key]!, category: spec.category,
  required: ["first_name", "last_name", "email"].includes(spec.key),
  humanOnly: !!spec.neverAutofill,
}));

export const ROLE_SUGGESTIONS = ["Back-End", "Front-End", "Full Stack", "Software Engineer", "Mobile", "DevOps", "Data Engineer", "QA", "Product Manager", "Designer"] as const;
export const LOCATION_SUGGESTIONS = ["Remote", "Hybrid", "Brazil", "São Paulo", "Rio de Janeiro", "Portugal", "United States", "Europe"] as const;
export const EXPERIENCE_LEVELS = ["Intern", "Junior", "Pleno", "Senior", "Staff / Specialist", "Management"] as const;
export const GENDERS = ["Female", "Male", "Non-binary", "Other", "Prefer not to say"] as const;

/**
 * How a field is entered. Values are always stored as text; `tags` and
 * `multiselect` store their entries comma-separated, the way the agent form does.
 */
export type AnswerInput =
  | { kind: "text" | "textarea" | "email" | "phone" | "url" | "date" | "yesno" }
  | { kind: "select" | "multiselect"; options: readonly string[] }
  | { kind: "tags"; suggestions?: readonly string[]; urls?: boolean };

const TAGS = (suggestions?: readonly string[]): AnswerInput => ({ kind: "tags", suggestions });
const INPUTS: Record<string, AnswerInput> = {
  email: { kind: "email" }, phone: { kind: "phone" }, birth_date: { kind: "date" },
  summary: { kind: "textarea" }, languages: TAGS(), desired_role: TAGS(ROLE_SUGGESTIONS), preferred_locations: TAGS(LOCATION_SUGGESTIONS),
  experience_level: { kind: "multiselect", options: EXPERIENCE_LEVELS },
  requires_sponsorship: { kind: "yesno" }, accepts_clt: { kind: "yesno" },
  linkedin_url: { kind: "url" }, github_url: { kind: "url" }, portfolio_url: { kind: "url" }, social_links: { kind: "tags", urls: true },
  eeo_gender: { kind: "select", options: GENDERS }, eeo_veteran: { kind: "yesno" }, eeo_disability: { kind: "yesno" },
};
/** The input of a catalog field; other keys are free text. */
export function answerInput(key: string): AnswerInput {
  return INPUTS[key] ?? (key.endsWith("_url") ? { kind: "url" } : { kind: "text" });
}
/** Entries of a comma-separated multi-value answer. */
export const answerEntries = (value: string): string[] => value.split(",").map(item => item.trim()).filter(Boolean);

const YES_NO = /^(yes|no|sim|n[aã]o|true|false)$/i;
const fail = (message: string) => ({ message });
function validDate(value: string): boolean {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : br ? [br[3], br[2], br[1]] : [];
  if (!year) return false;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
    && date.getTime() <= Date.now() && Number(year) >= 1900;
}
function webUrl(key: string, value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (key === "linkedin_url") return host === "linkedin.com" && /^\/in\/[^/]+\/?$/.test(url.pathname);
    if (key === "github_url") return host === "github.com" && /^\/[^/]+\/?$/.test(url.pathname);
    return true;
  } catch { return false; }
}

/** The zod schema that checks the typed value of one field. */
export function answerSchema(key: string): z.ZodString {
  const input = answerInput(key);
  const label = LABELS[key] ?? "website";
  const text = z.string().trim();
  switch (input.kind) {
    case "email": return text.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, fail("Enter a valid email address, such as name@example.com."));
    case "phone": return text.regex(/^[+\d\s().-]+$/, fail("Enter a phone number with at least seven digits, including the country code.")).refine(value => value.replace(/\D/g, "").length >= 7, fail("Enter a phone number with at least seven digits, including the country code."));
    case "date": return text.refine(validDate, fail("Enter a past date such as 1990-12-31 or 31/12/1990."));
    case "yesno": return text.refine(value => YES_NO.test(value) || /^prefer not to say$/i.test(value), fail("Choose Yes or No."));
    case "url": return text.refine(value => webUrl(key, value), fail(`Enter a complete HTTP or HTTPS ${label} URL.`));
    case "select": return text.refine(value => input.options.some(option => option.toLowerCase() === value.toLowerCase()), fail(`Choose one of: ${input.options.join(", ")}.`));
    case "multiselect": return text.refine(value => answerEntries(value).every(item => input.options.some(option => option.toLowerCase() === item.toLowerCase())), fail(`Choose from: ${input.options.join(", ")}.`));
    case "tags": return text.refine(value => answerEntries(value).length <= 20 && answerEntries(value).every(item => item.length <= 80), fail("Use up to 20 entries of 80 characters."))
      .refine(value => !input.urls || answerEntries(value).every(item => webUrl("", item)), fail("Enter complete HTTP or HTTPS URLs, separated by commas."));
    case "textarea": return text.max(5000, fail("Use at most 5,000 characters."));
    default: return text.max(500, fail("Use at most 500 characters."));
  }
}

/** Empty legacy values remain missing; they are never invented or coerced. */
export function validateAnswer(key: string, value: string | null): string | null {
  if (!value?.trim()) return null;
  const result = answerSchema(key).safeParse(value);
  return result.success ? null : result.error.issues[0]?.message ?? "Enter a valid answer.";
}

/** Canonical BCP 47 tags; default is the explicitly selected legacy version. */
export function answerLanguage(value = "default"): string {
  if (value === "default") return value;
  try { return Intl.getCanonicalLocales(value)[0] || invalidLanguage(); }
  catch { return invalidLanguage(); }
}
function invalidLanguage(): never { throw new Error("Enter a language tag such as en, pt-BR, or default."); }

export interface AnswerValue { key: string; value: string | null; language?: string }
export interface ResolvedAnswer {
  value?: string; language?: string; fallback: boolean;
  status: "ready" | "missing" | "invalid";
}
export function resolveAnswer(rows: AnswerValue[], key: string, language = "default", fallbackLanguage?: string): ResolvedAnswer {
  const requested = answerLanguage(language);
  const fallback = fallbackLanguage === undefined ? undefined : answerLanguage(fallbackLanguage);
  for (const lang of [requested, ...(fallback && fallback !== requested ? [fallback] : [])]) {
    const row = rows.find((entry) => entry.key === key && (entry.language ?? "default") === lang);
    if (!row?.value?.trim()) continue;
    if (validateAnswer(key, row.value)) return { status: "invalid", value: row.value, language: lang, fallback: lang !== requested };
    return { status: "ready", value: row.value, language: lang, fallback: lang !== requested };
  }
  return { status: "missing", fallback: false };
}
