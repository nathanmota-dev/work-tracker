import { db } from "../db/index.ts";
import { AtsError, readBest, readJob } from "../ats/store.ts";
import { currentSourceVersion } from "../variants/service.ts";
import { type Flags, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  return process.exit(1);
}

/** work-tracker ats score --job-id <n> | ats best: ATS keyword scores as JSON. */
export function atsCmd(sub: string, flags: Flags): void {
  try {
    if (sub === "best") return console.log(JSON.stringify(readBest(db(), currentSourceVersion), null, 2));
    if (sub !== "score") fail(`unknown ats subcommand: ${sub} (use score or best)`);
    const value = str(flags, "job-id");
    if (!value || !/^[1-9]\d*$/.test(value)) fail("missing or invalid --job-id (a positive job id)");
    console.log(JSON.stringify(readJob(db(), Number(value), currentSourceVersion), null, 2));
  } catch (error) {
    if (error instanceof AtsError) fail(error.message);
    throw error;
  }
}
