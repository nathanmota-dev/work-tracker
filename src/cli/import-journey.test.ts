import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { importJourneyCmd } from "./import-journey.ts";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { databaseDouble, cliSpies } from "../test/doubles.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: vi.fn() }));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  cliSpies();
});
test("Journey import reads explicit source, maps recruiter acceptance and normalizes dates/counts", async () => {
  vi.mocked(readFileSync).mockReturnValue(`## Recruiter Outreach Tracker
| Name | Company | Date Sent | Accepted? | Response? | Notes |
| --- | --- | --- | --- | --- | --- |
| One | Acme | 2026-09-01 | 1st degree | | note |
| Two | Beta | ? | Pending | | |
| Three | Gamma | 2026-09-02 | ✅ | | accepted |
| Four | Delta | 2026-09-03 | Accepted | | |
| too short | |
| | ignored | ? | Pending | | |

## Interviews
| Company | Date | Stage | Status | Notes |
| --- | --- | --- | --- | --- |
| Acme | TBD | screen | SCHEDULED | fixture |
| Beta | 2026-10-12 | technical | Completed | |
| too short | |

## Profile Metrics
| Date | Search Appearances/wk | Profile Views | Connections |
| --- | --- | --- | --- |
| 2026-10-01 | 1,234 | unknown | 5,000 |
| 2026-10-02 | | 0 | 2 |
| too short | |
`);
  await importJourneyCmd("/explicit/JOURNEY.md");
  expect(readFileSync).toHaveBeenCalledWith("/explicit/JOURNEY.md", "utf8");
  expect(d.statement.run.mock.calls).toEqual([
    [
      {
        $name: "One",
        $company: "Acme",
        $date: "2026-09-01",
        $status: "accepted",
        $note: "note",
      },
    ],
    [
      {
        $name: "Two",
        $company: "Beta",
        $date: null,
        $status: "pending",
        $note: "",
      },
    ],
    [
      {
        $name: "Three",
        $company: "Gamma",
        $date: "2026-09-02",
        $status: "accepted",
        $note: "accepted",
      },
    ],
    [
      {
        $name: "Four",
        $company: "Delta",
        $date: "2026-09-03",
        $status: "accepted",
        $note: "",
      },
    ],
    [
      {
        $company: "Acme",
        $when: null,
        $stage: "screen",
        $status: "scheduled",
        $notes: "fixture",
      },
    ],
    [
      {
        $company: "Beta",
        $when: "2026-10-12",
        $stage: "technical",
        $status: "completed",
        $notes: "",
      },
    ],
    [{ $at: "2026-10-01", $sa: 1234, $pv: null, $conn: 5000 }],
    [{ $at: "2026-10-02", $sa: null, $pv: 0, $conn: 2 }],
  ]);
  expect(notifyChange).toHaveBeenCalledWith("recruiters");
  expect(console.log).toHaveBeenCalledWith(
    "Imported: 4 recruiters, 2 interviews, 2 metric snapshots",
  );
});
test("missing sections do no writes and read/database failures do not notify", async () => {
  vi.mocked(readFileSync).mockReturnValue("No tables");
  await importJourneyCmd("/empty");
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(
    "Imported: 0 recruiters, 0 interviews, 0 metric snapshots",
  );
  vi.mocked(notifyChange).mockClear();
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("not found");
  });
  await expect(importJourneyCmd("/missing")).rejects.toThrow("not found");
  expect(notifyChange).not.toHaveBeenCalled();
  vi.mocked(readFileSync).mockReturnValue(
    "Recruiter Outreach Tracker\n| Name | Company | Date | Accepted | Response | Notes |\n| --- | --- | --- | --- | --- | --- |\n| One | Acme | ? | Pending | | |\n",
  );
  d.statement.run.mockImplementation(() => {
    throw new Error("db failed");
  });
  await expect(importJourneyCmd("/fixture")).rejects.toThrow("db failed");
  expect(notifyChange).not.toHaveBeenCalled();
});
