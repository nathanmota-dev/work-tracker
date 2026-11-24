import { basename } from "node:path";
import { ANSWER_CATALOG } from "../answers/catalog.ts";
import type { Database } from "../db/sqlite.ts";
import type { FillChecklistItem, FillPendingReason, FillReview } from "./types.ts";

const REASONS: Record<FillPendingReason, string> = {
  "no-stored-answer": "No saved answer for this field. Add it in Profile, then fill again.",
  "invalid-answer": "The saved answer is invalid. Correct it in Profile, then fill again.",
  ambiguous: "The question matches more than one saved answer. Answer it in the portal yourself.",
  "eeo-human-only": "Demographic question. It is never filled automatically; answer it in the portal yourself.",
  "no-match": "No saved answer matches this question. Answer it in the portal yourself.",
  other: "The agent left this field for your review. Check it in the portal.",
};
const CORRECTABLE = new Set<FillPendingReason>(["no-stored-answer", "invalid-answer"]);
const FILES: Record<string, string> = { resume: "Resume", cover_letter: "Cover letter" };
const PORTALS: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", generic: "Employer portal" };
export const FILL_INSTRUCTION = "Open the portal, check every filled answer and complete the pending fields yourself. Work Tracker never submits: after you submit in the browser, confirm it here with I submitted in the browser.";

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const spec = (key: string | null) => ANSWER_CATALOG.find(entry => entry.key === key);
const label = (key: string | null, fallback = ""): string => fallback || spec(key)?.label || FILES[key ?? ""] || key || "Unnamed field";
/** Only known, non-demographic answers can be corrected in Answers. */
const correction = (key: string | null): string | null => { const known = spec(key); return known && !known.humanOnly ? known.key : null; };

function answer(key: string, value: unknown): string {
  if (FILES[key] && typeof value === "string") return `${basename(value)} attached`;
  if (typeof value === "string") return value;
  return value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function reasonFor(key: string | null, raw: string): { reason: FillPendingReason; reasonText: string } {
  // Demographic questions stay human-only, whatever reason the agent reported.
  if (spec(key)?.humanOnly) return { reason: "eeo-human-only", reasonText: REASONS["eeo-human-only"] };
  if (Object.hasOwn(REASONS, raw) && raw !== "other") return { reason: raw as FillPendingReason, reasonText: REASONS[raw as FillPendingReason] };
  return { reason: "other", reasonText: raw ? `Left for your review: ${raw}.` : REASONS.other };
}

/** Pending entries come as matcher output ({label, key, skip}), skill output ({label, reason}) or legacy key strings. */
function pendingItem(entry: unknown): FillChecklistItem {
  const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : { key: text(entry) };
  const key = text(value.key) || null;
  const { reason, reasonText } = reasonFor(key, text(value.reason) || text(value.skip));
  return { label: label(key, text(value.label)), key, answer: null, result: "pending", reason, reasonText, correctionKey: CORRECTABLE.has(reason) ? correction(key) : null };
}

/** Map a stored fill result to a checklist: filled fields with the answer used, then pending fields with their reason. */
export function fillChecklist(fields: unknown, unfilled: unknown): FillChecklistItem[] {
  const entries = fields && typeof fields === "object" && !Array.isArray(fields) ? Object.entries(fields) : [];
  const filled = entries.map(([key, value]): FillChecklistItem => {
    const known = spec(key) || FILES[key] ? key : null;
    return { label: label(known, known ? "" : key), key: known, answer: answer(key, value), result: "filled", reason: null, reasonText: null, correctionKey: correction(known) };
  });
  return [...filled, ...(Array.isArray(unfilled) ? unfilled.map(pendingItem) : [])];
}

function parse(json: string | null): unknown {
  try { return JSON.parse(json ?? "null"); } catch { return null; }
}
function reviewUrl(value: string | null): string | null {
  try { const url = new URL(String(value)); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

type Row = { portal: string | null; external_url: string | null; fields_filled_json: string | null; unfilled_json: string | null; fill_status: string; submission_status: string; submitted_at: string | null; preparation_run_id: string | null; version_id: string | null; pdf_hash: string | null; used_at: string | null };

/** The application's last recorded fill result; null when it was never filled. */
export function fillReview(d: Database, applicationId: number): FillReview | null {
  const row = d.query(`SELECT a.portal, a.external_url, a.fields_filled_json, a.unfilled_json, a.fill_status, a.submission_status, a.submitted_at,
    a.preparation_run_id, u.version_id, u.pdf_hash, u.used_at FROM applications a
    LEFT JOIN application_documents u ON u.application_id = a.id WHERE a.id = ?`).get(applicationId) as Row | undefined;
  if (!row || row.fields_filled_json === null) return null;
  const items = fillChecklist(parse(row.fields_filled_json), parse(row.unfilled_json));
  const portal = row.portal || "generic";
  const filled = items.filter(item => item.result === "filled").length;
  return {
    applicationId, runId: row.preparation_run_id, portal, portalLabel: PORTALS[portal] ?? portal, reviewUrl: reviewUrl(row.external_url),
    document: row.version_id && row.pdf_hash && row.used_at ? { versionId: row.version_id, pdfHash: row.pdf_hash, usedAt: row.used_at } : null,
    fillStatus: row.fill_status, submitted: row.submission_status === "submitted", submittedAt: row.submitted_at,
    items, filled, pending: items.length - filled, instruction: FILL_INSTRUCTION,
  };
}
