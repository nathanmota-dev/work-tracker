import { webUrl } from "../jobs/identity.ts";

/** Categories of the company research checklist; each keeps where its facts came from. */
export const SOURCE_CATEGORIES = ["website", "reviews", "linkedin", "media"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export interface ResearchSource {
  url: string;
  notes: string | null;
}
export type ResearchSources = Partial<Record<SourceCategory, ResearchSource>>;

/** Research that cannot be cached because its input is not valid. */
export class CompanyResearchError extends Error {
  override name = "CompanyResearchError";
}

export const MAX_NOTES = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional text: trimmed, null when empty, rejected when it is not a string or too long. */
export function optionalText(value: unknown, field: string, max = MAX_NOTES): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new CompanyResearchError(`${field} must be text`);
  const text = value.trim();
  if (text.length > max) throw new CompanyResearchError(`${field} is longer than ${max} characters`);
  return text || null;
}

function parseSource(category: string, raw: unknown): ResearchSource {
  if (!isRecord(raw)) throw new CompanyResearchError(`sources.${category} must be an object with url and notes`);
  const url = typeof raw.url === "string" ? webUrl(raw.url.trim()) : null;
  if (!url) throw new CompanyResearchError(`sources.${category}.url must be an http or https URL without credentials`);
  return { url: url.href, notes: optionalText(raw.notes, `sources.${category}.notes`) };
}

/** Validates the checklist sources: known categories only, each with a safe web URL. */
export function parseSources(raw: unknown): ResearchSources {
  if (!isRecord(raw)) throw new CompanyResearchError("sources must be an object keyed by category");
  const sources: ResearchSources = {};
  for (const [category, value] of Object.entries(raw)) {
    if (!SOURCE_CATEGORIES.includes(category as SourceCategory)) {
      throw new CompanyResearchError(`unknown source category "${category}"; use ${SOURCE_CATEGORIES.join(", ")}`);
    }
    sources[category as SourceCategory] = parseSource(category, value);
  }
  if (!Object.keys(sources).length) throw new CompanyResearchError("at least one source is required");
  return sources;
}

/** Stored sources; a damaged column reads as no sources rather than failing the lookup. */
export function readSources(json: string): ResearchSources {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? (value as ResearchSources) : {};
  } catch {
    return {};
  }
}
