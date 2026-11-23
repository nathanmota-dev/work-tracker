import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { rankingCandidates } from "../rankings/candidates.ts";
import { listRankings } from "../rankings/list.ts";
import { saveRanking } from "../rankings/store.ts";
import { RankingError } from "../rankings/types.ts";
import { cliSpies } from "../test/doubles.ts";
import { rankingCmd } from "./rankings.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../rankings/candidates.ts", async (original) => ({ ...(await original<typeof import("../rankings/candidates.ts")>()), rankingCandidates: vi.fn() }));
vi.mock("../rankings/list.ts", () => ({ listRankings: vi.fn() }));
vi.mock("../rankings/store.ts", () => ({ saveRanking: vi.fn() }));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
  vi.mocked(db).mockReturnValue("db" as never);
});
const file = (text: string) => { vi.mocked(readFileSync).mockReturnValue(text); return "/rankings/1.json"; };

test("save stores one posting's result, prints it and notifies the UI", async () => {
  vi.mocked(saveRanking).mockReturnValue({ job_id: 3, overall: 75 } as never);
  await rankingCmd("save", { "job-id": "3", file: file(JSON.stringify({ status: "scored", scores: { technical: 80, experience: 70, career: 75 }, strengths: ["A"], gaps: ["B"] })) });
  expect(saveRanking).toHaveBeenCalledWith(expect.objectContaining({ jobId: 3, status: "scored", technical: 80 }));
  expect(notifyChange).toHaveBeenCalledWith("job_rankings");
  expect(JSON.parse(output.log.mock.calls[0]![0])).toEqual({ job_id: 3, overall: 75 });
});

test("save explains bad ids, missing files, invalid JSON and refused results without notifying", async () => {
  await expect(rankingCmd("save", { file: "x" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: missing or invalid --job-id (a positive job id)");
  await expect(rankingCmd("save", { "job-id": "3" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: missing required --file (JSON result of one posting)");
  await expect(rankingCmd("save", { "job-id": "3", file: file("{") })).rejects.toThrow("exit:1");
  expect(output.error.mock.lastCall![0]).toContain("not valid JSON");
  vi.mocked(saveRanking).mockImplementationOnce(() => { throw new RankingError("technical must be an integer score from 0 to 100"); });
  await expect(rankingCmd("save", { "job-id": "3", file: file('{"status":"scored"}') })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: technical must be an integer score from 0 to 100");
  expect(notifyChange).not.toHaveBeenCalled();
});

test("candidates passes limit, all and job ids; list prints rankings; unknown subcommands fail", async () => {
  vi.mocked(rankingCandidates).mockReturnValue({ items: [] } as never);
  await rankingCmd("candidates", { limit: "5", all: true, "job-ids": "1,2" });
  expect(rankingCandidates).toHaveBeenCalledWith("db", { limit: 5, all: true, jobIds: [1, 2] });
  await expect(rankingCmd("candidates", { limit: "0" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: limit must be an integer from 1 to 100");
  vi.mocked(listRankings).mockReturnValue([]);
  await rankingCmd("list", {});
  expect(output.log).toHaveBeenLastCalledWith("[]");
  await expect(rankingCmd("other", {})).rejects.toThrow("exit:1");
});
