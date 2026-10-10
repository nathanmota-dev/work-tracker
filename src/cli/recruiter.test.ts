import { beforeEach, expect, test, vi } from "vitest";
import { recruiterCmd } from "./recruiter.ts";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { runSync } from "../recruiter/sync.ts";
import { activityCmd } from "./records.ts";
import { databaseDouble, cliSpies } from "../test/doubles.ts";
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: () => "2026-10-10T12:00:00Z",
}));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../recruiter/sync.ts", () => ({ runSync: vi.fn() }));
vi.mock("./records.ts", () => ({ activityCmd: vi.fn() }));
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
const result = {
  scanned: 2,
  companiesQueried: 1,
  applied: false,
  skipped: ["Broken"],
  changes: [
    {
      id: 1,
      name: "One",
      company: "Acme",
      from: "pending",
      to: "accepted",
      matchedBy: "username" as const,
    },
  ],
};
beforeEach(() => {
  d = databaseDouble();
  d.statement.get.mockReturnValue({ id: 1 });
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(runSync).mockReset().mockResolvedValue(result);
  output = cliSpies();
});
test("adding a recruiter maps fields, defaults status/date/source and notifies after persistence", async () => {
  await recruiterCmd("add", { name: "One" });
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $name: "One",
    $username: null,
    $company: null,
    $title: null,
    $location: null,
    $degree: null,
    $mutuals: null,
    $status: "pending",
    $date: "2026-10-10T12:00:00Z",
    $note: null,
    $skill: "recruiter-outreach",
  });
  expect(notifyChange).toHaveBeenCalledWith("recruiters");
  await recruiterCmd("add", {
    name: "One",
    username: "one",
    company: "Acme",
    title: "Recruiter",
    location: "Brazil",
    degree: "2nd",
    mutuals: "[]",
    status: "accepted",
    date: "2026-10-01",
    note: "fixture",
    "source-skill": "manual",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $name: "One",
    $username: "one",
    $company: "Acme",
    $title: "Recruiter",
    $location: "Brazil",
    $degree: "2nd",
    $mutuals: "[]",
    $status: "accepted",
    $date: "2026-10-01",
    $note: "fixture",
    $skill: "manual",
  });
});
test("updates bind only supplied fields and preserve existing acceptance/reply timestamps", async () => {
  await recruiterCmd("update", { id: "2", note: "" });
  expect(d.statement.run).toHaveBeenLastCalledWith({ $id: 2, $note: "" });
  expect(d.query).toHaveBeenLastCalledWith(
    "UPDATE recruiters SET updated_at = datetime('now'), note = $note WHERE id = $id",
  );
  for (const status of ["accepted", "replied"]) {
    await recruiterCmd("update", {
      id: "2",
      status,
      username: "one",
      company: "Acme",
      title: "Recruiter",
      location: "Brazil",
      degree: "1st",
    });
    expect(d.statement.run).toHaveBeenLastCalledWith({
      $id: 2,
      $status: status,
      $username: "one",
      $company: "Acme",
      $title: "Recruiter",
      $location: "Brazil",
      $degree: "1st",
    });
    expect(d.query).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `${status === "accepted" ? "accepted_at" : "replied_at"} = COALESCE`,
      ),
    );
  }
});
test("sync dry-run previews changes without notifications; apply records activity and supports JSON", async () => {
  await recruiterCmd("sync", {});
  expect(runSync).toHaveBeenCalledWith({ apply: false });
  expect(notifyChange).not.toHaveBeenCalled();
  expect(output.log).toHaveBeenCalledWith(
    expect.stringContaining("would apply (dry-run)"),
  );
  expect(output.log).toHaveBeenCalledWith(
    "  skipped (detection error): Broken",
  );
  await recruiterCmd("sync", { apply: true, json: true });
  expect(runSync).toHaveBeenLastCalledWith({ apply: true });
  expect(notifyChange).toHaveBeenCalledWith("recruiters");
  expect(activityCmd).toHaveBeenCalledWith({
    kind: "recruiter_sync",
    skill: "recruiter-sync",
    summary: "Sync: 1 accepted (One)",
  });
  expect(output.log).toHaveBeenLastCalledWith(JSON.stringify(result, null, 2));
});
test("empty sync suppresses writes and text output handles multiple companies and missing names", async () => {
  vi.mocked(runSync).mockResolvedValue({
    ...result,
    companiesQueried: 2,
    changes: [],
    skipped: [],
  });
  await recruiterCmd("sync", { apply: true });
  expect(activityCmd).not.toHaveBeenCalled();
  expect(notifyChange).not.toHaveBeenCalled();
  expect(output.log).toHaveBeenCalledWith("  no new acceptances detected");
  vi.mocked(runSync).mockResolvedValue({
    ...result,
    changes: [{ ...result.changes[0], company: null }],
    skipped: [],
  });
  await recruiterCmd("sync", { apply: true });
  expect(output.log).toHaveBeenCalledWith(expect.stringContaining("@ ?"));
});
test("missing flags, unknown subcommands and sync errors exit without success notifications", async () => {
  await expect(recruiterCmd("add", {})).rejects.toThrow("exit:1");
  await expect(recruiterCmd("update", {})).rejects.toThrow("exit:1");
  await expect(recruiterCmd("missing", {})).rejects.toThrow("exit:1");
  vi.mocked(runSync).mockRejectedValue(new Error("offline"));
  await expect(recruiterCmd("sync", {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith(
    expect.stringContaining("sync failed — offline"),
  );
  expect(notifyChange).not.toHaveBeenCalled();
});
