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
import { saveJob } from "../jobs/store.ts";
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
vi.mock("../jobs/store.ts", () => ({ saveJob: vi.fn() }));
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  vi.mocked(saveJob).mockReset().mockReturnValue({ job: { id: 4 } as any, created: true, existing: false, missing: [] });
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
test("job commands map fields through shared validation and report existing records", async () => {
  await jobCmd("save", { "linkedin-id": "job-one", title: "Backend", company: "Acme", description: "Build" });
  expect(saveJob).toHaveBeenCalledWith(d.asDatabase, { linkedin_job_id: "job-one", title: "Backend", company_name: "Acme", description: "Build" }, undefined, true);
  expect(notifyChange).toHaveBeenCalledWith("jobs", expect.objectContaining({ status: "saved", job: expect.objectContaining({ id: 4 }) }));
  expect(output.log).toHaveBeenCalledWith("job #4 saved");
  await jobCmd("update", { id: "4", "source-id": "42", source: "ats", requirements: "[]", "work-type": "remote" });
  expect(saveJob).toHaveBeenLastCalledWith(d.asDatabase, { source_job_id: "42", source: "ats", requirements_json: "[]", work_type: "remote" }, 4, false);
  expect(output.log).toHaveBeenLastCalledWith("job #4 updated");
  vi.mocked(saveJob).mockReturnValue({ job: { id: 4 } as any, created: false, existing: true, missing: [] });
  vi.mocked(notifyChange).mockClear();
  await jobCmd("save", { "linkedin-id": "job-one" });
  expect(output.log).toHaveBeenLastCalledWith("job #4 already exists");
  expect(notifyChange).toHaveBeenCalledWith("jobs", expect.objectContaining({ status: "existing" }));
  for (const id of [undefined, "0", "-1", "1.5", "9007199254740992", "bad"])
    await expect(jobCmd("update", id ? { id } : {})).rejects.toThrow("positive job id");
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
    $cat: "contact",
    $at: "2026-10-10T12:00:00Z",
    $default: 1,
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
  vi.mocked(saveJob).mockImplementation(() => { throw new Error("db failed"); });
  await expect(jobCmd("save", {})).rejects.toThrow("db failed");
  expect(notifyChange).toHaveBeenCalledWith("jobs", { key: "unknown", status: "failed", error: "db failed" });
});

test("answer language commands canonicalize tags, filter category and delete only the selected version", async () => {
  await answerCmd("set", { key: "notice_period", value: "Duas semanas", language: "pt-br" });
  expect(d.statement.run).toHaveBeenLastCalledWith("notice_period", "pt-BR", "Duas semanas", "2026-10-10T12:00:00Z");
  d.statement.all.mockReturnValue([
    { key: "notice_period", language: "pt-BR", category: "eligibility", value: "Duas semanas" },
    { key: "custom", language: "en", category: "custom", value: "Custom text" },
    { key: "other", language: "pt-BR", category: "custom", value: "Outro texto" },
  ]);
  await answerCmd("list", { language: "pt-br", category: "eligibility" });
  expect(JSON.parse(String(output.log.mock.calls.at(-1)![0]))).toEqual([
    { key: "notice_period", language: "pt-BR", category: "eligibility", value: "Duas semanas" },
  ]);
  await answerCmd("list", { language: "en" });
  expect(JSON.parse(String(output.log.mock.calls.at(-1)![0]))).toHaveLength(1);
  await answerCmd("delete", { key: "notice_period", language: "pt-br" });
  expect(d.statement.run).toHaveBeenCalledWith("notice_period", "pt-BR");
  expect(notifyChange).toHaveBeenCalledWith("applicant_answers");
  expect(output.log).toHaveBeenLastCalledWith("Answer deleted.");
});
