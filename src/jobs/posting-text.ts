import { readableJobDetails } from "../preparation/generation.ts";

/** Headings that open the posting body on a LinkedIn job page, in English and Portuguese. */
const STARTS = ["About the job", "Sobre a vaga"];
/** Page sections that follow the posting body; everything from the first one on is LinkedIn chrome. */
const ENDS = [
  "Set alert for similar jobs", "See how you compare", "Job search faster with Premium", "Access company insights",
  "About the company", "Sobre a empresa", "Looking for talent?",
];
/** A sign-in notice is never a posting. */
const SIGN_IN = /login (?:is still in|in) progress|sign-in[^\n]*pending/i;

/** The page text: `sections.job_posting`, the `raw` text of a non-JSON reply, or the other known shapes. */
function pageText(details: unknown): string {
  const row = details && typeof details === "object" ? details as { sections?: unknown; raw?: unknown } : {};
  const posting = row.sections && typeof row.sections === "object" ? (row.sections as { job_posting?: unknown }).job_posting : undefined;
  if (typeof posting === "string") return posting;
  return typeof row.raw === "string" ? row.raw : readableJobDetails(details);
}

function firstIndex(text: string, markers: readonly string[]): { index: number; marker: string } | null {
  let first: { index: number; marker: string } | null = null;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index >= 0 && (!first || index < first.index)) first = { index, marker };
  }
  return first;
}

/**
 * The posting body of a LinkedIn `get_job_details` result: the text under
 * "About the job", without the page's buttons, Premium offers, company card or
 * similar jobs. Returns "" when the result holds no readable posting.
 */
export function postingText(details: unknown): string {
  const page = pageText(details);
  if (!page.trim() || SIGN_IN.test(page)) return "";
  const start = firstIndex(page, STARTS);
  const body = start ? page.slice(start.index + start.marker.length) : page;
  const end = firstIndex(body, ENDS);
  return (end ? body.slice(0, end.index) : body).replace(/\n{3,}/g, "\n\n").replace(/…\s*more\s*$/, "").trim();
}
