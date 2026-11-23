import { readFileSync } from "node:fs";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { ApplicationBoardError } from "../applications/validation.ts";
import { followUpDays, followupCandidates } from "../followups/candidates.ts";
import { listFollowups, saveFollowup } from "../followups/store.ts";
import { FollowupError } from "../followups/types.ts";
import { type Flags, int, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function known(error: unknown): string {
  return error instanceof FollowupError || error instanceof ApplicationBoardError || (error as NodeJS.ErrnoException).code === "ENOENT"
    ? (error as Error).message
    : String(error);
}

async function saveCmd(flags: Flags): Promise<void> {
  const file = str(flags, "file");
  if (!file) fail("missing required --file (Markdown body of the message)");
  const event = str(flags, "stage-event");
  try {
    const id = saveFollowup({
      applicationId: int(flags, "application-id") ?? Number.NaN,
      kind: str(flags, "kind") ?? "",
      channel: str(flags, "channel") ?? "",
      body: readFileSync(file, "utf8"),
      subject: str(flags, "subject"),
      ...(event === undefined ? {} : { stageEventId: /^[1-9]\d*$/.test(event) ? Number(event) : Number.NaN }),
    });
    await notifyChange("followup_drafts");
    console.log(`followup draft #${id} saved; the user sends it and marks it as sent in Work Tracker`);
  } catch (error) {
    fail(known(error));
  }
}

/** work-tracker followup save | list | candidates */
export async function followupCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "save") return saveCmd(flags);
  if (sub === "list") {
    console.log(JSON.stringify(listFollowups(int(flags, "application-id")), null, 2));
    return;
  }
  if (sub !== "candidates") fail(`unknown followup subcommand: ${sub}`);
  try {
    console.log(JSON.stringify(followupCandidates(db(), { days: followUpDays(str(flags, "days")) }), null, 2));
  } catch (error) {
    fail(known(error));
  }
}
