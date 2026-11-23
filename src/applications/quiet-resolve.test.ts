import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, memoryDatabase } from "../test/memory-db.ts";
import { resolveQuiet } from "./quiet-resolve.ts";
import { executeApplicationAction } from "./store.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-10-17T10:00:00.000Z" }));

const NOW = Date.parse("2026-10-17T10:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
let d: Database;
const applied = () => (d.query("SELECT id FROM application_stages WHERE key = 'applied'").get() as { id: number }).id;
const sent = (company_name: string, days: number, fields: Record<string, string | number | null> = {}) =>
  insertApplication(d, {
    company_name, status: "submitted", submission_status: "submitted", submitted_at: ago(days), applied_at: ago(days),
    tracking_status: "active", current_stage_id: applied(), created_at: ago(days), updated_at: ago(days), ...fields,
  });
const archivedEvents = () => d.query("SELECT application_id, reason, note FROM application_events WHERE event_type = 'archived' ORDER BY id").all();
const tracking = (id: number) => d.query("SELECT tracking_status, archive_reason, archived_at FROM applications WHERE id = ?").get(id);

beforeEach(async () => {
  d = await memoryDatabase();
});

test("closes the selected quiet applications as No response with a closing note", () => {
  const first = sent("First", 75);
  const second = sent("Second", 61);
  const untouched = sent("Untouched", 90);
  expect(resolveQuiet(d, { ids: [first, second, first] })).toEqual({ resolved: [first, second], skipped: [] });
  expect(tracking(first)).toEqual({ tracking_status: "archived", archive_reason: "no_response", archived_at: "2026-10-17T10:00:00.000Z" });
  expect(tracking(untouched)).toMatchObject({ tracking_status: "active" });
  expect(archivedEvents()).toEqual([
    { application_id: first, reason: "no_response", note: "Closed by quiet sweep (75 days without activity)" },
    { application_id: second, reason: "no_response", note: "Closed by quiet sweep (61 days without activity)" },
  ]);
});

test("repeating, late activity, unreadable dates and unknown IDs are skipped without new events", () => {
  const closed = sent("Closed", 70);
  const active = sent("Active", 70);
  const unreadable = sent("Unreadable", 70, { applied_at: "unknown" });
  resolveQuiet(d, { ids: [closed] });
  // Activity recorded between the listing and the confirmation keeps the application open.
  d.query(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
    VALUES (?, 'moved', ?, 'Applied', 'applied', ?)`).run(active, applied(), ago(1));
  expect(resolveQuiet(d, { ids: [closed, active, unreadable, 404] })).toEqual({
    resolved: [],
    skipped: [
      { id: closed, reason: "Already archived" },
      { id: active, reason: "No longer quiet" },
      { id: unreadable, reason: 'Unreadable date: applied_at "unknown"' },
      { id: 404, reason: "Application not found" },
    ],
  });
  expect(archivedEvents()).toHaveLength(1);
  // A stricter threshold leaves out what the user did not see as quiet.
  expect(resolveQuiet(d, { ids: [sent("Recent", 30)], days: 60 }).skipped).toEqual([expect.objectContaining({ reason: "No longer quiet" })]);
  expect(resolveQuiet(d, { ids: [sent("Thirty", 30)], days: 30 }).resolved).toHaveLength(1);
});

test("requires a non-empty list of valid IDs", () => {
  for (const ids of [undefined, [], "1", {}])
    expect(() => resolveQuiet(d, { ids })).toThrow("Select at least one application to close.");
  expect(() => resolveQuiet(d, { ids: [1, "2"] })).toThrow("Expected a valid record ID.");
});

test("board actions scan without changes and report changes only when something closed", () => {
  const quiet = sent("Quiet", 65);
  expect(executeApplicationAction("quiet", {}, d)).toEqual({
    value: { days: 60, items: [expect.objectContaining({ id: quiet, days_quiet: 65 })], skipped: [] },
    changed: [],
  });
  expect(executeApplicationAction("quiet", { days: "70" }, d).value).toMatchObject({ days: 70, items: [] });
  expect(() => executeApplicationAction("quiet", { days: 3 }, d)).toThrow(expect.objectContaining({ status: 400 }));
  expect(() => executeApplicationAction("quiet/resolve", { ids: [quiet], days: 0 }, d)).toThrow(expect.objectContaining({ status: 400 }));
  expect(executeApplicationAction("quiet/resolve", { ids: [quiet] }, d)).toEqual({
    value: { resolved: [quiet], skipped: [] },
    changed: ["applications", "application_events"],
  });
  expect(executeApplicationAction("quiet/resolve", { ids: [quiet] }, d)).toEqual({
    value: { resolved: [], skipped: [{ id: quiet, reason: "Already archived" }] },
    changed: [],
  });
  // Reopening from the board keeps the previous stage, as before the sweep.
  expect(executeApplicationAction("reopen", { id: quiet }, d).value).toMatchObject({ tracking_status: "active", archive_reason: null, current_stage_id: applied() });
});
