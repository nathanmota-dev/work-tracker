import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, memoryDatabase } from "../test/memory-db.ts";
import { lastActivityAt, MAX_DAYS, MIN_DAYS, quietApplications, quietDays, STALE_DAYS } from "./quiet.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));

const NOW = Date.parse("2026-10-17T10:00:00.000Z");
const ago = (days: number, hours = 0) => new Date(NOW - days * 86_400_000 - hours * 3_600_000).toISOString();
let d: Database;
const stageId = (key: string) => (d.query("SELECT id FROM application_stages WHERE key = ?").get(key) as { id: number }).id;
/** A submitted application on the board, sent `days` ago with no other activity. */
const sent = (company_name: string, days: number, fields: Record<string, string | number | null> = {}) =>
  insertApplication(d, {
    company_name, role_title: `${company_name} role`, status: "submitted", submission_status: "submitted",
    submitted_at: ago(days), applied_at: ago(days), tracking_status: "active", current_stage_id: stageId("applied"),
    created_at: ago(days), updated_at: ago(0), ...fields,
  });
const addEvent = (applicationId: number, occurred_at: string) =>
  d.query(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
    VALUES (?, 'moved', ?, 'Applied', 'applied', ?)`).run(applicationId, stageId("applied"), occurred_at);
const addTransition = (applicationId: number, occurred_at: string) =>
  d.query(`INSERT INTO application_transitions (application_id, dimension, action, from_state, to_state, actor, occurred_at)
    VALUES (?, 'submission', 'submit', 'not_submitted', 'submitted', 'api', ?)`).run(applicationId, occurred_at);
const ids = () => quietApplications(d).items.map((item) => item.id);

beforeEach(async () => {
  d = await memoryDatabase();
});

test("exports the default and minimum thresholds", () => {
  expect([STALE_DAYS, MIN_DAYS]).toEqual([60, 7]);
});

test("counts whole days from the latest activity and includes the exact threshold", () => {
  const exact = sent("Exact", 60);
  const almost = sent("Almost", 59, { submitted_at: ago(59, 23), applied_at: ago(59, 23) });
  const older = sent("Older", 90);
  const result = quietApplications(d);
  expect(result).toEqual({
    days: 60,
    skipped: [],
    items: [
      { id: older, company_name: "Older", role_title: "Older role", stage_name: "Applied", stage_category: "applied",
        applied_at: ago(90), last_activity_at: ago(90), days_quiet: 90 },
      expect.objectContaining({ id: exact, days_quiet: 60 }),
    ],
  });
  expect(quietApplications(d, { days: 90 }).items.map((item) => item.id)).toEqual([older]);
  expect(quietApplications(d, { days: 59, now: ago(-1) }).items.map((item) => item.id)).toEqual([older, exact, almost]);
});

test("never lists drafts, prepared or filled records, archived ones or offers", () => {
  const kept = sent("Kept", 80);
  sent("Draft", 80, { status: "draft", submission_status: "not_submitted", submitted_at: null, tracking_status: null, current_stage_id: null });
  sent("Prepared", 80, { preparation_status: "ready", submission_status: "not_submitted", submitted_at: null, tracking_status: null, current_stage_id: null });
  sent("Filled", 80, { fill_status: "filled", submission_status: "not_submitted", submitted_at: null, tracking_status: null, current_stage_id: null });
  sent("Archived", 80, { tracking_status: "archived", archive_reason: "rejected", archived_at: ago(70) });
  sent("Offer", 80, { current_stage_id: stageId("offer") });
  expect(ids()).toEqual([kept]);
});

test("a recent board event or journey transition resets the clock; updated_at does not", () => {
  const moved = sent("Moved", 100);
  const transitioned = sent("Transitioned", 100);
  const edited = sent("Edited", 100, { updated_at: ago(1) });
  addEvent(moved, ago(10));
  addTransition(transitioned, ago(5));
  addEvent(edited, ago(70));
  expect(quietApplications(d).items).toEqual([expect.objectContaining({ id: edited, days_quiet: 70, last_activity_at: ago(70) })]);
  expect(lastActivityAt(d, moved)).toBe(ago(10));
  expect(lastActivityAt(d, transitioned)).toBe(ago(5));
  expect(lastActivityAt(d, edited)).toBe(ago(70));
});

test("unreadable or missing dates are skipped and reported, never guessed", () => {
  const unreadable = sent("Unreadable", 100, { applied_at: "sometime in spring" });
  const undated = sent("Undated", 100, { submitted_at: null, applied_at: null });
  const recent = sent("Recent", 2, { applied_at: "not a date" });
  addEvent(undated, "  ");
  expect(quietApplications(d)).toEqual({
    days: 60,
    items: [],
    skipped: [
      { id: unreadable, company_name: "Unreadable", role_title: "Unreadable role", reason: 'Unreadable date: applied_at "sometime in spring"' },
      { id: undated, company_name: "Undated", role_title: "Undated role", reason: "No submission or activity date" },
    ],
  });
  // A readable recent date already proves activity, so the record is neither quiet nor skipped.
  expect(lastActivityAt(d, recent)).toBe(ago(2));
  expect(lastActivityAt(d, undated)).toBeNull();
});

test("validates thresholds from JSON, query strings and CLI flags", () => {
  expect(quietDays(undefined)).toBe(60);
  expect(quietDays(null)).toBe(60);
  expect(quietDays("")).toBe(60);
  expect(quietDays(7)).toBe(7);
  expect(quietDays(" 90 ")).toBe(90);
  expect(quietDays(MAX_DAYS)).toBe(MAX_DAYS);
  for (const invalid of [6, 7.5, -10, "6", "9O", "1e2", true, MAX_DAYS + 1, [60]])
    expect(() => quietDays(invalid)).toThrow(expect.objectContaining({ status: 400, message: "Days without activity must be a whole number from 7 to 3650." }));
});
