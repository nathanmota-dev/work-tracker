import { readFileSync } from "node:fs";
import { notifyChange } from "../db/notify.ts";
import { applicationContext } from "../interview-prep/context.ts";
import { InterviewPrepError, listInterviewPreps, saveInterviewPrep } from "../interview-prep/store.ts";
import { type Flags, int, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** work-tracker application show --id <n>: the data an interview pack is built from. */
export function applicationShowCmd(flags: Flags): void {
  const id = int(flags, "id");
  if (id === undefined) fail("missing required --id");
  const context = applicationContext(id);
  if (!context) fail(`application #${id} not found`);
  console.log(JSON.stringify(context, null, 2));
}

/** work-tracker interview-prep save | list */
export async function interviewPrepCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "list") {
    console.log(JSON.stringify(listInterviewPreps(int(flags, "application-id")).map(({ body_md, ...pack }) => ({ ...pack, characters: body_md.length })), null, 2));
    return;
  }
  if (sub !== "save") fail(`unknown interview-prep subcommand: ${sub}`);
  const file = str(flags, "file");
  if (!file) fail("missing required --file (Markdown pack to store)");
  try {
    const id = saveInterviewPrep({
      applicationId: int(flags, "application-id") ?? Number.NaN,
      stage: str(flags, "stage") ?? "",
      body: readFileSync(file, "utf8"),
      scheduledAt: str(flags, "when"),
      format: str(flags, "format"),
      interviewers: str(flags, "interviewers"),
    });
    await notifyChange("interview_preps");
    console.log(`interview prep #${id} saved`);
  } catch (error) {
    fail(error instanceof InterviewPrepError || (error as NodeJS.ErrnoException).code === "ENOENT" ? (error as Error).message : String(error));
  }
}
