import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, memoryDatabase } from "../test/memory-db.ts";
import { followupCandidates } from "./candidates.ts";
import { discardFollowup, markFollowupSent, saveFollowup } from "./store.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

const NOW = "2026-11-20T12:00:00.000Z";
const ago = (days: number, hours = 0) => new Date(Date.parse(NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();
const body = Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ");
let d: Database;
const stage = (key: string) => d.query("SELECT id, name, category FROM application_stages WHERE key = ?").get(key) as { id: number; name: string; category: string };
const sent = (company_name: string, days: number, fields: Record<string, string | number | null> = {}) =>
  insertApplication(d, {
    company_name, role_title: "Engineer", status: "submitted", submission_status: "submitted", submitted_at: ago(days),
    applied_at: ago(days), tracking_status: "active", current_stage_id: stage("applied").id, ...fields,
  });
const move = (applicationId: number, key: string, occurred_at: string, type = "moved") => {
  const { id, name, category } = stage(key);
  return (d.query(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING id`).get(applicationId, type, id, name, category, occurred_at) as { id: number }).id;
};
const draft = (applicationId: number, kind = "follow_up", stageEventId?: number) =>
  saveFollowup({ applicationId, kind, channel: "portal", body, ...(stageEventId ? { stageEventId } : {}) }, d);
const due = (options = {}) => followupCandidates(d, { now: NOW, ...options });

beforeEach(async () => { d = await memoryDatabase(); });

test("a submitted application quiet for 10+ days is due, with what was sent and drafted", () => {
  const quiet = sent("Quiet", 12);
  sent("Recent", 9);
  expect(due()).toEqual({
    days: 10,
    thank_yous: [],
    follow_ups: [{ id: quiet, company_name: "Quiet", role_title: "Engineer", stage_name: "Applied", last_activity_at: ago(12), days_quiet: 12, sent_count: 0, has_draft: false }],
  });
  draft(quiet);
  expect(due().follow_ups[0]).toMatchObject({ sent_count: 0, has_draft: true });
  expect(due({ days: 13 }).follow_ups).toEqual([]);
});

test("marking a follow-up as sent restarts the clock; drafts and discarded drafts do not", () => {
  const app = sent("Acme", 20);
  discardFollowup(draft(app), d);
  draft(app);
  expect(due().follow_ups.map((item) => item.id)).toEqual([app]);
  markFollowupSent(draft(app), d);
  expect(due().follow_ups).toEqual([]);
  expect(due({ now: new Date(Date.parse(NOW) + 10 * 86_400_000).toISOString() }).follow_ups[0]).toMatchObject({ id: app, days_quiet: 10, sent_count: 1 });
});

test("an application with two sent follow-ups is never offered a third", () => {
  const app = sent("Capped", 30);
  d.exec(`INSERT INTO followup_drafts (application_id, kind, channel, body_md, status, created_at, sent_at)
    VALUES (${app}, 'follow_up', 'email', 'x', 'sent', '${ago(25)}', '${ago(25)}'), (${app}, 'follow_up', 'email', 'x', 'sent', '${ago(15)}', '${ago(15)}')`);
  expect(due().follow_ups).toEqual([]);
});

test("drafts, archived applications and offers are excluded from follow-ups", () => {
  sent("Draft", 30, { submission_status: "not_submitted", submitted_at: null });
  sent("Archived", 30, { tracking_status: "archived" });
  sent("Offer", 30, { current_stage_id: stage("offer").id });
  expect(due().follow_ups).toEqual([]);
});

test("a recent move into an interview stage offers one thank-you note until it is drafted", () => {
  const app = sent("Interview", 3);
  const screen = move(app, "recruiter", ago(5));
  const technical = move(app, "technical", ago(1));
  expect(due().thank_yous).toEqual([{ id: app, company_name: "Interview", role_title: "Engineer", stage_name: stage("technical").name, stage_event_id: technical, occurred_at: ago(1) }]);
  const note = draft(app, "thank_you", technical);
  // The answered latest event hides the offer; the older screen is not offered instead.
  expect(due().thank_yous).toEqual([]);
  discardFollowup(note, d);
  expect(due().thank_yous.map((item) => item.stage_event_id)).toEqual([technical]);
  markFollowupSent(draft(app, "thank_you", technical), d);
  expect(due().thank_yous).toEqual([]);
  expect(screen).toBeLessThan(technical);
});

test("thank-you offers cover only the last week, interview categories, moves and registrations of active applications", () => {
  d.exec("INSERT INTO application_stages (key, name, category, position, created_at, updated_at) VALUES ('assessment', 'Take-home', 'assessment', 9, 'x', 'x')");
  const created = sent("Created", 1);
  move(created, "technical", ago(2), "created");
  move(sent("Old", 30), "recruiter", ago(7));
  move(sent("Applied stage", 30), "applied", ago(1));
  move(sent("Archived", 30, { tracking_status: "archived" }), "assessment", ago(1));
  move(sent("Reopened", 30), "assessment", ago(1), "reopened");
  move(sent("Future", 30), "assessment", ago(-1));
  move(sent("Unreadable", 30), "assessment", "not a date");
  const edge = sent("Edge", 30);
  move(edge, "assessment", ago(6, 23));
  expect(due().thank_yous.map((item) => item.id)).toEqual([created, edge]);
});
