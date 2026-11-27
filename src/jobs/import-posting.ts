import { parseDeadline } from "../deadlines/urgency.ts";
import { guardDescription } from "../postings/description.ts";
import { decodeEntities } from "../postings/guard/entities.ts";
import { linkedinJobId, normalizeLink } from "./identity.ts";

/** Form fields a job page can fill; empty ones are left out so typed values are kept. */
export type ImportedFields = Partial<Record<"title" | "company_name" | "location" | "work_type" | "comp" | "deadline" | "source" | "description", string>>;
/**
 * @property fields Values to show in the form, with the description already cleaned.
 * @property description_source The description as published, saved when the user keeps it
 *   unchanged so the posting check records what it removed.
 */
export interface ImportedPosting { fields: ImportedFields; description_source?: string }
type Node = Record<string, unknown>;

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const LD_JSON = /\btype\s*=\s*["']?application\/ld\+json/i;
const MAX_DEPTH = 6;
const MAX_LOCATIONS = 3;

const isNode = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** One line of plain text from a value that may carry entities or markup. */
function text(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return decodeEntities(String(value)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
/** A schema.org value written either as text or as a named object. */
const named = (value: unknown): string => text(isNode(value) ? value.name : value);

function parseJson(source: string): unknown {
  try { return JSON.parse(source); } catch { /* some sites leave raw line breaks inside strings */ }
  // eslint-disable-next-line no-control-regex
  try { return JSON.parse(source.replace(/[\x00-\x1f]+/g, " ")); } catch { return null; }
}

function collect(value: unknown, found: Node[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (isNode(value) && list(value["@type"]).includes("JobPosting")) { found.push(value); return; }
  const children = Array.isArray(value) ? value : isNode(value) ? Object.values(value) : [];
  for (const child of children) collect(child, found, depth + 1);
}

/** Every schema.org `JobPosting` published in the page's JSON-LD blocks. */
export function jobPostings(html: string): Node[] {
  const found: Node[] = [];
  for (const [, attributes, body] of html.matchAll(SCRIPT))
    if (LD_JSON.test(attributes!)) collect(parseJson(body!.trim()), found);
  return found;
}

/** The only posting, or the one that names this link; `null` when the page lists several others. */
export function selectPosting(postings: Node[], link: string): Node | null {
  const key = (node: Node) => `${text(node.title)}\n${named(node.hiringOrganization)}`;
  if (new Set(postings.map(key)).size === 1) return postings[0]!;
  const url = normalizeLink(link);
  const matches = postings.filter(node => [node.url, node["@id"]].some(value => typeof value === "string" && normalizeLink(value) === url));
  return matches.length === 1 ? matches[0]! : null;
}

function place(value: unknown): string {
  const address = isNode(value) ? value.address ?? value.name : value;
  if (!isNode(address)) return text(address);
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry].map(named).filter(Boolean);
  return [...new Map(parts.map(part => [part.toLowerCase(), part])).values()].join(", ");
}

function location(node: Node): string {
  const places = list(node.jobLocation).map(place).filter(Boolean);
  const fallback = places.length ? places : list(node.applicantLocationRequirements).map(named).filter(Boolean);
  return [...new Set(fallback)].slice(0, MAX_LOCATIONS).join("; ");
}

function compensation(value: unknown): string {
  if (!isNode(value)) return text(value);
  const amount = isNode(value.value) ? value.value : { value: value.value };
  const range = [amount.minValue, amount.maxValue].map(text).filter(Boolean);
  const figures = [...new Set(range)].join("–") || text(amount.value);
  if (!figures || figures === "0") return "";
  const unit = text((amount as Node).unitText).toLowerCase();
  return [text(value.currency), figures, unit && `/ ${unit}`].filter(Boolean).join(" ");
}

function deadline(value: unknown): string {
  const day = text(value).slice(0, 10);
  return parseDeadline(day) ? day : "";
}

function description(value: unknown): { text: string; source: string } | null {
  if (typeof value !== "string") return null;
  // Some sites publish the markup entity-escaped inside the JSON string.
  const markup = !/<\/?[a-z]/i.test(value) && /&lt;\/?[a-z]/i.test(value) ? decodeEntities(value) : value;
  // The wrapper makes the posting check read any markup as HTML; list items keep a visible bullet.
  const source = /<\/?[a-z][^>]*>/i.test(markup)
    ? `<div>${markup.replace(/(<li\b[^>]*>)\s*<p>/gi, "$1").replace(/<li\b[^>]*>(?!\s*(?:<[^>]*>\s*)*[-•*])/gi, "$&- ")}</div>`
    : decodeEntities(markup).trim();
  const cleaned = guardDescription(source).description;
  return cleaned ? { text: cleaned, source } : null;
}

/** LinkedIn identity comes from its URL; every other site is identified by its host. */
function sourceName(link: string): string {
  const host = new URL(link).hostname.replace(/^www\./, "");
  return linkedinJobId(link) || /(^|\.)linkedin\.com$/.test(host) ? "" : host;
}

/**
 * Map a `JobPosting` to form fields. The posting's own identifier is not used: it is
 * only unique inside one company, so the link identifies the job.
 */
export function postingFields(node: Node, link: string): ImportedPosting {
  const body = description(node.description);
  const remote = list(node.jobLocationType).some(type => text(type).toUpperCase() === "TELECOMMUTE");
  const values: ImportedFields = {
    title: text(node.title), company_name: named(node.hiringOrganization), location: location(node),
    work_type: remote ? "Remote" : "", comp: compensation(node.baseSalary), deadline: deadline(node.validThrough),
    source: sourceName(link), description: body?.text ?? "",
  };
  const fields = Object.fromEntries(Object.entries(values).filter(([, value]) => value)) as ImportedFields;
  return { fields, ...(body ? { description_source: body.source } : {}) };
}
