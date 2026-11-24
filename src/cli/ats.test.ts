import { beforeEach, expect, test, vi } from "vitest";
import { cliSpies } from "../test/doubles.ts";
import { AtsError, readBest, readJob } from "../ats/store.ts";
import { currentSourceVersion } from "../variants/service.ts";
import { atsCmd } from "./ats.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(() => "db") }));
vi.mock("../variants/service.ts", () => ({ currentSourceVersion: vi.fn() }));
vi.mock("../ats/store.ts", async (original) => ({ ...(await original<typeof import("../ats/store.ts")>()), readBest: vi.fn(() => [{ job_id: 1, score: 82 }]), readJob: vi.fn(() => ({ job_id: 3, documents: [] })) }));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => { output = cliSpies(); });
const printed = () => JSON.parse(String(output.log.mock.calls.at(-1)![0]));

test("prints the best resume per job and one job's scores as JSON", () => {
  atsCmd("best", {});
  expect(printed()).toEqual([{ job_id: 1, score: 82 }]);
  expect(readBest).toHaveBeenCalledWith("db", currentSourceVersion);
  atsCmd("score", { "job-id": "3" });
  expect(printed()).toEqual({ job_id: 3, documents: [] });
  expect(readJob).toHaveBeenCalledWith("db", 3, currentSourceVersion);
});

test("rejects unknown subcommands, invalid job IDs and missing jobs", () => {
  expect(() => atsCmd("delete", {})).toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: unknown ats subcommand: delete (use score or best)");
  expect(() => atsCmd("score", { "job-id": "0" })).toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: missing or invalid --job-id (a positive job id)");
  vi.mocked(readJob).mockImplementationOnce(() => { throw new AtsError("Job not found.", 404); });
  expect(() => atsCmd("score", { "job-id": "9" })).toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: Job not found.");
  vi.mocked(readBest).mockImplementationOnce(() => { throw new Error("boom"); });
  expect(() => atsCmd("best", {})).toThrow("boom");
});
