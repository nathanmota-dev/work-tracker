import { beforeEach, expect, test, vi } from "vitest";
import {
  jobCmd,
  metricCmd,
  scoreCmd,
  interviewCmd,
  applicationCmd,
  answerCmd,
  activityCmd,
} from "./records.ts";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { cliSpies, databaseDouble } from "../test/doubles.ts";
import {
  applyStatus,
  journeyRecord,
  openApplication,
  resolveJob,
  transition,
  type JourneyRecord,
} from "../applications/journey-store.ts";
import { JourneyError } from "../applications/journey.ts";
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: () => "2026-10-10T12:00:00Z",
}));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../applications/journey-store.ts", () => ({
  applyStatus: vi.fn(),
  journeyRecord: vi.fn(),
  openApplication: vi.fn(),
  resolveJob: vi.fn(),
  transition: vi.fn(),
}));
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  d = databaseDouble();
  d.statement.get.mockReturnValue({ id: 4 });
  vi.mocked(db).mockReturnValue(d.asDatabase);
  output = cliSpies();
  vi.mocked(resolveJob).mockReset().mockReturnValue(7);
  vi.mocked(openApplication).mockReset().mockReturnValue({ record: { id: 5, attempt: 1 } as JourneyRecord, created: true });
  vi.mocked(applyStatus).mockReset();
  vi.mocked(journeyRecord).mockReset();
  vi.mocked(transition).mockReset().mockReturnValue({ record: {} as JourneyRecord, changed: true });
  vi.mocked(notifyChange).mockClear();
});
test("job saves map flags and default status before notification", async () => {
  await jobCmd("save", {
    "linkedin-id": "job-one",
    title: "Backend",
    company: "Acme",
  });
  expect(d.statement.get).toHaveBeenCalledWith({
    $jid: "job-one",
    $title: "Backend",
    $company: "Acme",
    $location: null,
    $work: null,
    $comp: null,
    $fit: null,
    $reqs: null,
    $status: "saved",
    $link: null,
  });
  expect(notifyChange).toHaveBeenCalledWith("jobs");
  expect(output.log).toHaveBeenCalledWith("job #4 saved");
  await jobCmd("save", {
    location: "Brazil",
    "work-type": "remote",
    comp: "100",
    fit: "high",
    requirements: "[]",
    status: "applied",
    link: "https://fixture.invalid",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $jid: null,
      $work: "remote",
      $fit: "high",
      $status: "applied",
      $reqs: "[]",
      $comp: "100",
      $link: "https://fixture.invalid",
    }),
  );
});
test("metrics and scores preserve zero, optional dates and nulls", async () => {
  await metricCmd({
    "profile-views": "0",
    "search-appearances": "invalid",
    at: "2026-09-01",
    score: "75",
    breakdown: "{}",
  });
  expect(d.statement.get).toHaveBeenCalledWith({
    $at: "2026-09-01",
    $sa: null,
    $pv: 0,
    $pi: null,
    $conn: null,
    $score: 75,
    $breakdown: "{}",
  });
  await metricCmd({ "post-impressions": "10", connections: "20" });
  expect(d.statement.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $at: "2026-10-10T12:00:00Z",
      $pi: 10,
      $conn: 20,
    }),
  );
  await scoreCmd({ value: "0", signals: "[]" });
  expect(d.statement.run).toHaveBeenCalledWith({
    $at: "2026-10-10T12:00:00Z",
    $score: 0,
    $breakdown: "[]",
  });
  expect(notifyChange).toHaveBeenCalledWith("profile_metrics");
});
test("interviews and applications bind optional fields and defaults", async () => {
  await interviewCmd("add", { company: "Acme" });
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $company: "Acme",
    $when: null,
    $stage: null,
    $status: "scheduled",
    $notes: null,
  });
  expect(notifyChange).toHaveBeenCalledWith("interviews");
  await interviewCmd("add", {
    company: "Acme",
    when: "2026-10-11",
    stage: "screen",
    status: "completed",
    note: "fixture",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $company: "Acme",
    $when: "2026-10-11",
    $stage: "screen",
    $status: "completed",
    $notes: "fixture",
  });
});
test("application add resolves local or external job IDs and reuses the job's application", async () => {
  await applicationCmd("add", { "job-id": "2", "keyword-score": "0", status: "draft" });
  expect(resolveJob).toHaveBeenCalledWith(d.asDatabase, { jobId: 2, linkedinJobId: undefined });
  expect(openApplication).toHaveBeenCalledWith(d.asDatabase, { jobId: 7, origin: "agent", newAttempt: false, idempotencyKey: null });
  expect(d.statement.run).toHaveBeenCalledWith(0, "2026-10-10T12:00:00Z", 5);
  expect(applyStatus).toHaveBeenCalledWith(d.asDatabase, 5, "draft", "cli");
  expect(transition).not.toHaveBeenCalled();
  expect(output.log).toHaveBeenLastCalledWith("application #5 added");
  vi.mocked(openApplication).mockReturnValueOnce({ record: { id: 5, attempt: 1 } as JourneyRecord, created: false });
  await applicationCmd("add", { "linkedin-job-id": "li-9", "resume-path": "resume", "new-attempt": true, "idempotency-key": "k" });
  expect(resolveJob).toHaveBeenLastCalledWith(d.asDatabase, { jobId: undefined, linkedinJobId: "li-9" });
  expect(openApplication).toHaveBeenLastCalledWith(d.asDatabase, { jobId: 7, origin: "agent", newAttempt: true, idempotencyKey: "k" });
  // A tailored resume records preparation, never a submission.
  expect(transition).toHaveBeenCalledWith(d.asDatabase, 5, "prepare.complete", "cli");
  expect(output.log).toHaveBeenLastCalledWith("application #5 reused (attempt 1)");
  expect(notifyChange).toHaveBeenCalledWith("applications");
});
test("application add reports journey rule errors without notifying", async () => {
  vi.mocked(openApplication).mockImplementationOnce(() => {
    throw new JourneyError("Application #5 for this job is not submitted yet; continue it instead of starting a new attempt.");
  });
  await expect(applicationCmd("add", { "job-id": "2", "new-attempt": true })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith(expect.stringContaining("continue it instead"));
  expect(notifyChange).not.toHaveBeenCalled();
});
test("application update changes only supplied fields and routes status through the journey", async () => {
  await applicationCmd("update", {
    id: "4",
    status: "submitted",
    "external-url": "",
  });
  expect(d.query).toHaveBeenCalledWith(
    "UPDATE applications SET external_url = ?, updated_at = ? WHERE id = ?",
  );
  expect(d.statement.run).toHaveBeenCalledWith("", "2026-10-10T12:00:00Z", 4);
  expect(applyStatus).toHaveBeenCalledWith(d.asDatabase, 4, "submitted", "cli");
  vi.mocked(journeyRecord).mockImplementationOnce(() => {
    throw new JourneyError("Application not found.", 404);
  });
  await expect(
    applicationCmd("update", { id: "9", status: "applied" }),
  ).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: application #9 not found");
  vi.mocked(applyStatus).mockImplementationOnce(() => {
    throw new JourneyError("A submitted application cannot return to draft.");
  });
  await expect(
    applicationCmd("update", { id: "4", status: "draft" }),
  ).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: A submitted application cannot return to draft.");
});
test("answers preserve null values, list category filters and activity supplies defaults", async () => {
  await answerCmd("set", { key: "email" });
  expect(d.statement.run).toHaveBeenLastCalledWith({
    $key: "email",
    $value: null,
    $cat: "custom",
    $at: "2026-10-10T12:00:00Z",
  });
  await answerCmd("set", {
    key: "email",
    value: "candidate@example.invalid",
    category: "contact",
  });
  expect(d.statement.run).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $value: "candidate@example.invalid",
      $cat: "contact",
    }),
  );
  expect(notifyChange).toHaveBeenCalledWith("applicant_answers");
  d.statement.all.mockReturnValue([{ key: "email" }]);
  await answerCmd("list", {});
  expect(d.statement.all).toHaveBeenLastCalledWith();
  await answerCmd("list", { category: "contact" });
  expect(d.statement.all).toHaveBeenLastCalledWith("contact");
  await activityCmd({});
  expect(d.statement.run).toHaveBeenLastCalledWith({
    $kind: "skill-run",
    $skill: null,
    $summary: null,
    $payload: null,
  });
  await activityCmd({
    kind: "sync",
    skill: "tracker",
    summary: "done",
    payload: "{}",
  });
  expect(d.statement.run).toHaveBeenLastCalledWith({
    $kind: "sync",
    $skill: "tracker",
    $summary: "done",
    $payload: "{}",
  });
  expect(notifyChange).toHaveBeenCalledWith("activity_log");
});
test("validations stop before writes and report unknown subcommands", async () => {
  for (const call of [
    () => jobCmd("unknown", {}),
    () => interviewCmd("unknown", {}),
    () => applicationCmd("unknown", {}),
    () => answerCmd("unknown", {}),
    () => scoreCmd({}),
    () => interviewCmd("add", {}),
    () => applicationCmd("update", {}),
    () => applicationCmd("update", { id: "1" }),
    () => answerCmd("set", {}),
  ])
    await expect(call()).rejects.toThrow("exit:1");
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(d.statement.get).not.toHaveBeenCalled();
  expect(notifyChange).not.toHaveBeenCalled();
});
test("database failures never notify a successful write", async () => {
  d.statement.get.mockImplementation(() => {
    throw new Error("db failed");
  });
  await expect(jobCmd("save", {})).rejects.toThrow("db failed");
  expect(notifyChange).not.toHaveBeenCalled();
});
