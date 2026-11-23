import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { saveJob } from "../jobs/store.ts";
import { guardVerdict } from "../postings/description.ts";
import { type Flags, str } from "./flags.ts";

const columns: Record<string, string> = {
  "linkedin-id": "linkedin_job_id", title: "title", company: "company_name", location: "location",
  "work-type": "work_type", comp: "comp", fit: "fit", requirements: "requirements_json",
  status: "status", link: "link", description: "description", source: "source", "source-id": "source_job_id", deadline: "deadline",
};

/** CLI writes use exactly the same validation and identity rules as the manual form. */
export async function jobCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "list") {
    // Agents see the verdict only: the stored excerpts quote content hidden from the reader.
    const jobs = db().query("SELECT * FROM jobs ORDER BY scouted_at DESC, id DESC").all() as Record<string, unknown>[];
    console.log(JSON.stringify(jobs.map(({ description_guard_json, ...job }) => ({ ...job, guard_verdict: guardVerdict(description_guard_json) })), null, 2));
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
    let result;
    try { result = saveJob(db(), body, sub === "update" ? Number(id) : undefined, sub === "save"); }
    catch (error) {
      if (sub === "save") await notifyChange("jobs", { key: body.link ?? body.linkedin_job_id ?? body.title ?? "unknown", status: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    await notifyChange("jobs", sub === "save" ? { key: String(result.job.id), status: result.existing ? "existing" : "saved", job: result.job } : undefined);
    console.log(result.job.archived_at ? `job #${result.job.id} remains archived`
      : `job #${result.job.id} ${result.existing ? "already exists" : sub === "update" ? "updated" : "saved"}`);
    if (body.description && result.job.description_guard_json && !result.existing) console.log(guardVerdict(result.job.description_guard_json));
    return;
  }
  console.error(`unknown job subcommand: ${sub}`);
  process.exit(1);
}
