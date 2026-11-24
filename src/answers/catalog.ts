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
  accepts_clt: "Accepts CLT hiring", social_links: "Other social links",
  linkedin_url: "LinkedIn profile", github_url: "GitHub profile", portfolio_url: "Portfolio website",
  eeo_gender: "Gender", eeo_race: "Race / ethnicity", eeo_veteran: "Veteran status", eeo_disability: "Disability status",
};
export const ANSWER_CATALOG = KEY_SPECS.map((spec) => ({
  key: spec.key, label: LABELS[spec.key]!, category: spec.category,
  required: ["first_name", "last_name", "email"].includes(spec.key),
  humanOnly: !!spec.neverAutofill,
}));

/** Empty legacy values remain missing; they are never invented or coerced. */
export function validateAnswer(key: string, value: string | null): string | null {
  if (!value?.trim()) return null;
  if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    return "Enter a valid email address, such as name@example.com.";
  if (key.endsWith("_url")) {
    try {
      const url = new URL(value.trim());
      if (!["https:", "http:"].includes(url.protocol) || !url.hostname) throw new Error();
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (key === "linkedin_url" && (host !== "linkedin.com" || !/^\/in\/[^/]+\/?$/.test(url.pathname))) throw new Error();
      if (key === "github_url" && (host !== "github.com" || !/^\/[^/]+\/?$/.test(url.pathname))) throw new Error();
    } catch {
      return `Enter a complete HTTP or HTTPS ${LABELS[key] ?? "website"} URL.`;
    }
  }
  if (key === "birth_date" && !/^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/.test(value.trim()))
    return "Enter a date such as 1990-12-31 or 31/12/1990.";
  if (key === "phone" && (!/^[+\d\s().-]+$/.test(value) || value.replace(/\D/g, "").length < 7))
    return "Enter a phone number with at least seven digits, including the country code.";
  return null;
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
