/**
 * How long a cached company research stays fresh, counted from `fetched_at`.
 * The only place the TTL is defined: the CLI, the API, the page and the skills read it from here.
 */
export const COMPANY_RESEARCH_TTL_DAYS = 30;

/**
 * Cache key of a company name: lowercase, trimmed, inner whitespace as one hyphen.
 * Legal suffixes are kept on purpose ("Acme Corp Ltd" is not "Acme Corp"): a
 * near-miss only costs a cache miss and a fresh research, never a wrong answer.
 */
export function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
