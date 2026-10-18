import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { saveJob } from "../jobs/store.ts";
import { type Flags, str } from "./flags.ts";

const columns: Record<string, string> = {
  "linkedin-id": "linkedin_job_id", title: "title", company: "company_name", location: "location",
  "work-type": "work_type", comp: "comp", fit: "fit", requirements: "requirements_json",
  status: "status", link: "link", description: "description", source: "source", "source-id": "source_job_id",
};

/** CLI writes use exactly the same validation and identity rules as the manual form. */
export async function jobCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "list") {
    console.log(JSON.stringify(db().query("SELECT * FROM jobs ORDER BY scouted_at DESC, id DESC").all(), null, 2));
    return;
  }
  if (sub === "save" || sub === "update") {
    const id = str(flags, "id");
    if (sub === "update" && (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1))
      throw new Error("Expected a positive job id (--id).");
    const body = Object.fromEntries(Object.entries(columns).flatMap(([flag, column]) => {
      const value = str(flags, flag);
      return value === undefined ? [] : [[column, value]];
    }));
    const result = saveJob(db(), body, sub === "update" ? Number(id) : undefined, sub === "save");
    if (!result.existing || body.fit !== undefined || body.status !== undefined) await notifyChange("jobs");
    console.log(result.job.archived_at ? `job #${result.job.id} remains archived`
      : `job #${result.job.id} ${result.existing ? "already exists" : sub === "update" ? "updated" : "saved"}`);
    return;
  }
  console.error(`unknown job subcommand: ${sub}`);
  process.exit(1);
}
