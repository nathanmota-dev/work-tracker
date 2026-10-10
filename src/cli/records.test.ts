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
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: () => "2026-10-10T12:00:00Z",
}));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  d = databaseDouble();
  d.statement.get.mockReturnValue({ id: 4 });
  vi.mocked(db).mockReturnValue(d.asDatabase);
  output = cliSpies();
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
  await applicationCmd("add", {});
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $job: null,
    $resume: null,
    $cover: null,
    $report: null,
    $score: null,
    $status: "draft",
    $applied: null,
    $portal: null,
    $url: null,
  });
  await applicationCmd("add", {
    "job-id": "2",
    "resume-path": "resume",
    "cover-path": "cover",
    "report-path": "report",
    "keyword-score": "0",
    status: "applied",
    "applied-at": "2026-10-10",
    portal: "ashby",
    "external-url": "https://fixture.invalid",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $job: 2,
    $resume: "resume",
    $cover: "cover",
    $report: "report",
    $score: 0,
    $status: "applied",
    $applied: "2026-10-10",
    $portal: "ashby",
    $url: "https://fixture.invalid",
  });
  expect(notifyChange).toHaveBeenCalledWith("applications");
});
test("application update changes only supplied fields, including an explicit empty string", async () => {
  await applicationCmd("update", {
    id: "4",
    status: "applied",
    "external-url": "",
  });
  expect(d.statement.get).toHaveBeenCalledWith({
    $id: 4,
    $status: "applied",
    $external_url: "",
  });
  expect(d.query).toHaveBeenCalledWith(
    "UPDATE applications SET status = $status, external_url = $external_url WHERE id = $id RETURNING id",
  );
  d.statement.get.mockReturnValue(undefined);
  await expect(
    applicationCmd("update", { id: "9", status: "applied" }),
  ).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: application #9 not found");
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
