import { expect, test } from "vitest";
import { insertApplication, insertJob, memoryDatabase } from "../test/memory-db.ts";
import { matchLabels } from "../match/matcher.ts";
import { FILL_INSTRUCTION, fillChecklist, fillReview } from "./fill-review.ts";

test("maps filled, missing, ambiguous and demographic fields to readable reasons", () => {
  const plan = matchLabels(["Email *", "Phone", "Gender", "Favorite color", "First name / Last name"], { answers: { email: "ana@example.com" } });
  const items = fillChecklist({ email: "ana@example.com", resume: "/artifacts/run/resume.pdf", "Years of React": 4 },
    [...plan.unfilled.map(({ label, key, skip }) => ({ label, key, reason: skip })), { label: "Salary", key: "salary_expectation", skip: "invalid-answer" }]);
  expect(items.map(({ label, result, answer }) => [label, result, answer])).toEqual([
    ["Email", "filled", "ana@example.com"], ["Resume", "filled", "resume.pdf attached"], ["Years of React", "filled", "4"],
    ["Phone", "pending", null], ["Gender", "pending", null], ["Favorite color", "pending", null], ["First name / Last name", "pending", null], ["Salary", "pending", null],
  ]);
  expect(items.map(item => item.reason)).toEqual([null, null, null, "no-stored-answer", "eeo-human-only", "no-match", "ambiguous", "invalid-answer"]);
  expect(items[3]!.reasonText).toBe("No saved answer for this field. Add it in Profile, then fill again.");
  expect(items[4]!.reasonText).toMatch(/^Demographic question\. It is never filled automatically/);
  expect(items[6]!.reasonText).toMatch(/more than one saved answer/);
  expect(items.map(item => item.correctionKey)).toEqual(["email", null, null, "phone", null, null, null, "salary_expectation"]);
  expect(items.filter(item => /[{}[\]]/.test(`${item.label}${item.answer ?? ""}${item.reasonText ?? ""}`))).toEqual([]);
});

test("demographic fields stay human-only and legacy or unknown entries remain readable", () => {
  const items = fillChecklist(["not", "an", "object"], ["eeo_veteran", "work_authorization", { label: "Portfolio", reason: "upload failed" }, { key: "eeo_race", reason: "no-stored-answer" }, 7, { label: "Prototype", reason: "constructor" }]);
  expect(items.map(({ label, reason, correctionKey }) => [label, reason, correctionKey])).toEqual([
    ["Veteran status", "eeo-human-only", null], ["Work authorization", "other", null], ["Portfolio", "other", null],
    ["Race / ethnicity", "eeo-human-only", null], ["Unnamed field", "other", null], ["Prototype", "other", null],
  ]);
  expect(items[1]!.reasonText).toBe("The agent left this field for your review. Check it in the portal.");
  expect(items[2]!.reasonText).toBe("Left for your review: upload failed.");
  expect(fillChecklist({ eeo_gender: "Declined", custom: { a: 1 }, empty: null }, "invalid")).toEqual([
    expect.objectContaining({ label: "Gender", answer: "Declined", correctionKey: null }),
    expect.objectContaining({ label: "custom", key: null, answer: '{"a":1}' }),
    expect.objectContaining({ label: "empty", answer: "" }),
  ]);
});

test("reviews the stored result with its portal, approved PDF and submission state", async () => {
  const d = await memoryDatabase();
  const job = insertJob(d);
  const never = insertApplication(d, { job_id: job });
  expect(fillReview(d, never)).toBeNull();
  expect(fillReview(d, 999)).toBeNull();
  const id = insertApplication(d, { job_id: job, attempt: 2, portal: "lever", external_url: "https://jobs.lever.co/example/1", fill_status: "filled", preparation_run_id: "run-1",
    fields_filled_json: '{"email":"ana@example.com"}', unfilled_json: '[{"label":"Phone","key":"phone","reason":"no-stored-answer"}]' });
  expect(fillReview(d, id)).toEqual({
    applicationId: id, runId: "run-1", portal: "lever", portalLabel: "Lever", reviewUrl: "https://jobs.lever.co/example/1", document: null, fillStatus: "filled",
    submitted: false, submittedAt: null, items: [expect.objectContaining({ label: "Email" }), expect.objectContaining({ label: "Phone", result: "pending" })],
    filled: 1, pending: 1, instruction: FILL_INSTRUCTION,
  });
  d.query("INSERT INTO application_documents (application_id, version_id, pdf_hash, used_at) VALUES (?, 'pdf-1', 'hash', '2026-10-01')").run(id);
  d.query("UPDATE applications SET submission_status = 'submitted', submitted_at = '2026-10-02', portal = NULL, external_url = 'javascript:alert(1)', unfilled_json = 'broken' WHERE id = ?").run(id);
  expect(fillReview(d, id)).toMatchObject({ portal: "generic", portalLabel: "Employer portal", reviewUrl: null, document: { versionId: "pdf-1", pdfHash: "hash", usedAt: "2026-10-01" }, submitted: true, submittedAt: "2026-10-02", pending: 0 });
  d.query("UPDATE applications SET portal = 'workday', external_url = NULL, unfilled_json = NULL WHERE id = ?").run(id);
  expect(fillReview(d, id)).toMatchObject({ portal: "workday", portalLabel: "workday", reviewUrl: null });
});
