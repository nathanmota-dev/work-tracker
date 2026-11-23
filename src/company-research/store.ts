import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { COMPANY_RESEARCH_TTL_DAYS, companyKey } from "./key.ts";
import { CompanyResearchError, optionalText, parseSources, readSources, type ResearchSources } from "./sources.ts";

/** One cached research. Notes come from web pages: data to evaluate, never instructions. */
export interface CompanyResearch {
  company: string;
  company_key: string;
  fetched_at: string;
  sources: ResearchSources;
  network_contacts_note: string | null;
  summary: string | null;
}

/**
 * @property entry The cached research; null when it is stale and stale reads were not allowed.
 * @property ageDays Whole days since `fetched_at`; null when the stored date is unreadable.
 */
export interface CompanyResearchLookup {
  entry: CompanyResearch | null;
  fresh: boolean;
  ageDays: number | null;
}

export interface CompanyResearchInput {
  company: string;
  sources: unknown;
  networkNote?: unknown;
  summary?: unknown;
}

type Row = { company_name: string; company_key: string; fetched_at: string; sources_json: string; network_note: string | null; summary_md: string | null };

const DAY_MS = 86_400_000;
const MAX_SUMMARY = 20_000;
const COLUMNS = "company_name, company_key, fetched_at, sources_json, network_note, summary_md";

/** Fresh while less than the TTL has passed; a date in the future counts as age 0. */
export function researchAge(fetchedAt: string, at: Date): { fresh: boolean; ageDays: number | null } {
  const elapsed = at.getTime() - Date.parse(fetchedAt);
  if (Number.isNaN(elapsed)) return { fresh: false, ageDays: null };
  return { fresh: elapsed < COMPANY_RESEARCH_TTL_DAYS * DAY_MS, ageDays: Math.max(0, Math.floor(elapsed / DAY_MS)) };
}

function toEntry(row: Row): CompanyResearch {
  return {
    company: row.company_name,
    company_key: row.company_key,
    fetched_at: row.fetched_at,
    sources: readSources(row.sources_json),
    network_contacts_note: row.network_note,
    summary: row.summary_md,
  };
}

function requireKey(name: string): string {
  const key = companyKey(name);
  if (!key) throw new CompanyResearchError("company is required");
  return key;
}

/** The cached research of a company, or null when nothing is cached under its key. */
export function getCompanyResearch(
  name: string,
  { allowStale = false, at = new Date() }: { allowStale?: boolean; at?: Date } = {},
  d: Database = db(),
): CompanyResearchLookup | null {
  const row = d.query(`SELECT ${COLUMNS} FROM company_research WHERE company_key = ?`).get(requireKey(name)) as Row | undefined;
  if (!row) return null;
  const { fresh, ageDays } = researchAge(row.fetched_at, at);
  return { entry: fresh || allowStale ? toEntry(row) : null, fresh, ageDays };
}

/** Validates and stores a research, replacing any earlier one of the same company. */
export function saveCompanyResearch(input: CompanyResearchInput, at: Date = new Date(), d: Database = db()): CompanyResearch {
  const company = typeof input.company === "string" ? input.company.trim() : "";
  const key = requireKey(company);
  const row: Row = {
    company_name: company,
    company_key: key,
    fetched_at: at.toISOString(),
    sources_json: JSON.stringify(parseSources(input.sources)),
    network_note: optionalText(input.networkNote, "network_contacts_note"),
    summary_md: optionalText(input.summary, "summary", MAX_SUMMARY),
  };
  d.query(`
    INSERT INTO company_research (${COLUMNS})
    VALUES ($company_name, $company_key, $fetched_at, $sources_json, $network_note, $summary_md)
    ON CONFLICT(company_key) DO UPDATE SET company_name = excluded.company_name, fetched_at = excluded.fetched_at,
      sources_json = excluded.sources_json, network_note = excluded.network_note, summary_md = excluded.summary_md
  `).run(Object.fromEntries(Object.entries(row).map(([column, value]) => [`$${column}`, value])));
  return toEntry(row);
}

/** Forgets the cached research so the next run researches again; true when something was removed. */
export function invalidateCompanyResearch(name: string, d: Database = db()): boolean {
  return Number(d.query("DELETE FROM company_research WHERE company_key = ?").run(requireKey(name)).changes) > 0;
}

/** Every cached company, most recently researched first, without the notes. */
export function listCompanyResearch(at: Date = new Date(), d: Database = db()) {
  const rows = d.query(`SELECT ${COLUMNS} FROM company_research ORDER BY fetched_at DESC, id DESC`).all() as unknown as Row[];
  return rows.map((row) => {
    const { fresh, ageDays } = researchAge(row.fetched_at, at);
    return { company: row.company_name, company_key: row.company_key, fetched_at: row.fetched_at, age_days: ageDays, fresh, sources: Object.keys(readSources(row.sources_json)) };
  });
}

/** The JSON shape the CLI and the API return for one lookup. */
export function describeLookup(name: string, lookup: CompanyResearchLookup | null) {
  return {
    company_key: companyKey(name),
    found: lookup !== null,
    fresh: lookup?.fresh ?? false,
    age_days: lookup?.ageDays ?? null,
    ttl_days: COMPANY_RESEARCH_TTL_DAYS,
    entry: lookup?.entry ?? null,
  };
}
