import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertApplication, memoryDatabase } from "../test/memory-db.ts";
import { discardFollowup, listFollowups, markFollowupSent, saveFollowup, sentFollowUps, wordCount } from "./store.ts";
import { FollowupError } from "./types.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
let d: Database;
let app: number;
beforeEach(async () => {
  d = await memoryDatabase();
  app = insertApplication(d, { company_name: "Acme", submission_status: "submitted", tracking_status: "active" });
});
const save = (fields: Partial<Parameters<typeof saveFollowup>[0]> = {}) =>
  saveFollowup({ applicationId: app, kind: "follow_up", channel: "linkedin", body: words(80), ...fields }, d);
const event = () => (d.query(`INSERT INTO application_events (application_id, event_type, to_stage_id, stage_name, stage_category, occurred_at)
  VALUES (?, 'moved', 2, 'Recruiter screen', 'recruiter', '2026-11-19T12:00:00.000Z') RETURNING id`).get(app) as { id: number }).id;

test("counts words and ignores standalone Markdown punctuation", () => {
  expect(wordCount(" Hello,  team — I'm   still\n\ninterested - **really** ")).toBe(6);
});

test("stores a trimmed draft with its subject and lists drafts newest first", () => {
  const first = save({ channel: "email", subject: "  Backend Engineer application ", body: `  ${words(60)}  ` });
  const second = save({ kind: "thank_you", channel: "portal", body: words(120) });
  expect(listFollowups(app, d).map((draft) => draft.id)).toEqual([second, first]);
  expect(listFollowups(undefined, d)).toHaveLength(2);
  expect(listFollowups(app + 1, d)).toEqual([]);
  expect(listFollowups(app, d)[1]).toMatchObject({
    kind: "follow_up", channel: "email", subject: "Backend Engineer application", body_md: words(60),
    status: "draft", stage_event_id: null, created_at: "2026-11-20T12:00:00.000Z", sent_at: null,
  });
});

test.each([
  [{ applicationId: 0 }, "positive integer"],
  [{ kind: "nudge" }, "kind must be one of"],
  [{ channel: "sms" }, "channel must be one of"],
  [{ body: "   " }, "the draft is empty"],
  [{ body: words(59) }, "59 words"],
  [{ body: words(121) }, "121 words"],
  [{ channel: "email" }, "needs a subject"],
  [{ subject: "Hello" }, "linkedin message has no subject"],
  [{ stageEventId: 3 }, "only a thank-you"],
  [{ kind: "thank_you", stageEventId: Number.NaN }, "stage event id must be a positive integer"],
  [{ applicationId: 999 }, "#999 not found"],
  [{ kind: "thank_you", stageEventId: 999 }, "does not belong"],
])("rejects %j without writing", (fields, message) => {
  expect(() => save(fields)).toThrow(FollowupError);
  expect(() => save(fields)).toThrow(message);
  expect(listFollowups(undefined, d)).toEqual([]);
});

test("links a thank-you note to the stage event it answers", () => {
  const stage = event();
  const id = save({ kind: "thank_you", stageEventId: stage });
  expect(listFollowups(app, d)[0]).toMatchObject({ id, kind: "thank_you", stage_event_id: stage });
});

test("marking as sent records the date once and is idempotent", () => {
  const id = save();
  expect(markFollowupSent(id, d)).toEqual({ changed: true, draft: expect.objectContaining({ id, status: "sent", sent_at: "2026-11-20T12:00:00.000Z" }) });
  expect(markFollowupSent(id, d)).toEqual({ changed: false, draft: expect.objectContaining({ status: "sent" }) });
  expect(sentFollowUps(app, d)).toBe(1);
  expect(() => discardFollowup(id, d)).toThrow("a sent message cannot be discarded");
});

test("discarding keeps counts unchanged, is idempotent and blocks sending", () => {
  const id = save();
  expect(discardFollowup(id, d)).toEqual({ changed: true, draft: expect.objectContaining({ status: "discarded", sent_at: null }) });
  expect(discardFollowup(id, d).changed).toBe(false);
  expect(sentFollowUps(app, d)).toBe(0);
  expect(() => markFollowupSent(id, d)).toThrow("a discarded draft cannot be marked as sent");
});

test("after two sent follow-ups a third is refused at save and at send; thank-you notes are not capped", () => {
  const pending = save();
  markFollowupSent(save(), d);
  markFollowupSent(save(), d);
  expect(() => save()).toThrow(expect.objectContaining({ status: 409, message: expect.stringContaining("2 follow-ups were already sent") }));
  expect(() => markFollowupSent(pending, d)).toThrow("do not offer a third one");
  expect(markFollowupSent(save({ kind: "thank_you" }), d).changed).toBe(true);
  expect(sentFollowUps(app, d)).toBe(2);
});

test.each([[0], ["1"], [1.5], [undefined]])("rejects the draft id %j", (id) => {
  expect(() => markFollowupSent(id, d)).toThrow("draft id must be a positive integer");
});

test("reports unknown drafts as not found", () => {
  expect(() => discardFollowup(42, d)).toThrow(expect.objectContaining({ status: 404, message: "draft #42 not found" }));
});
