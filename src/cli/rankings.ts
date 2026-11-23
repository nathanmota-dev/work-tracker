import { readFileSync } from "node:fs";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { rankingCandidates, rankingJobIds, rankingLimit } from "../rankings/candidates.ts";
import { rankingInput } from "../rankings/input.ts";
import { listRankings } from "../rankings/list.ts";
import { saveRanking } from "../rankings/store.ts";
import { RankingError } from "../rankings/types.ts";
import { type Flags, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function known(error: unknown): string {
  if (error instanceof SyntaxError) return `the result file is not valid JSON: ${error.message}`;
  return error instanceof RankingError || (error as NodeJS.ErrnoException).code === "ENOENT" ? (error as Error).message : String(error);
}

function jobId(flags: Flags): number {
  const value = str(flags, "job-id");
  if (!value || !/^[1-9]\d*$/.test(value)) fail("missing or invalid --job-id (a positive job id)");
  return Number(value);
}

/** Stores one posting's result right after scoring it, so progress survives a failed run. */
async function saveCmd(flags: Flags): Promise<void> {
  const id = jobId(flags);
  const file = str(flags, "file");
  if (!file) fail("missing required --file (JSON result of one posting)");
  try {
    const ranking = saveRanking(rankingInput(id, JSON.parse(readFileSync(file, "utf8"))));
    await notifyChange("job_rankings");
    console.log(JSON.stringify(ranking, null, 2));
  } catch (error) {
    fail(known(error));
  }
}

/** work-tracker ranking candidates | save | list */
export async function rankingCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "save") return saveCmd(flags);
  if (sub === "list") {
    console.log(JSON.stringify(listRankings(db()), null, 2));
    return;
  }
  if (sub !== "candidates") fail(`unknown ranking subcommand: ${sub}`);
  try {
    console.log(JSON.stringify(rankingCandidates(db(), {
      limit: rankingLimit(str(flags, "limit")),
      all: flags.all === true,
      jobIds: rankingJobIds(str(flags, "job-ids")),
    }), null, 2));
  } catch (error) {
    fail(known(error));
  }
}
