import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import { runRecord } from "./store.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => { d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase); });
test("preparation consumers see a cancellable permission wait, then resume without a false completion", () => {
  const events = [{ type: "acp-status", status: "running" }, { type: "acp-status", status: "waiting_for_permission" }];
  const record = { id: "run", status: "running", events_json: JSON.stringify(events) };
  d.statement.get.mockReturnValue(record);
  expect(runRecord("run")).toMatchObject({ status: "running", decisionStatus: "waiting_for_permission" });
  events.push({ type: "acp-status", status: "running" });
  d.statement.get.mockReturnValue({ ...record, events_json: JSON.stringify(events) });
  expect(runRecord("run").decisionStatus).toBeUndefined();
  d.statement.get.mockReturnValue({ ...record, status: "interrupted" });
  expect(runRecord("run").decisionStatus).toBeUndefined();
});
