import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { type Flags, str, int } from "./flags.ts";
import { resolveJob } from "../applications/journey-store.ts";
import { linkJob } from "../applications/job-link.ts";
import { reconcileReviews, refreshReview, resolveReview, reviewItems } from "../applications/review.ts";

export const REVIEW_SUBCOMMANDS = ["review", "reconcile", "resolve", "link"];

/** Board-change tables an effective reconciliation touches. */
async function notifyTracked(): Promise<void> {
  await notifyChange("applications");
  await notifyChange("application_events");
}

/**
 * work-tracker application review | reconcile | resolve | link. Legacy records
 * are reconciled with the same rules as the Applications screen: `reconcile`
 * applies only safe fixes, and ambiguous records wait for `resolve` or `link`.
 */
export async function applicationReviewCmd(sub: string, flags: Flags): Promise<void> {
  const d = db();
  if (sub === "review") {
    console.log(JSON.stringify(reviewItems(d), null, 2));
    return;
  }
  if (sub === "reconcile") {
    const { fixed, items } = d.transaction(() => reconcileReviews(d, "cli"))();
    if (fixed.length) await notifyTracked();
    console.log(`${fixed.length} application(s) reconciled; ${items.length} still need review`);
    return;
  }
  const id = int(flags, "id");
  if (sub === "resolve") {
    const { item, changed } = d.transaction(() => resolveReview(d, {
      id, decision: str(flags, "decision"), company_name: str(flags, "company"),
      external_url: str(flags, "external-url"), applied_at: str(flags, "applied-at"),
    }, "cli"))();
    if (changed) await notifyTracked();
    console.log(!changed ? `application #${id} needs no review` : item ? `application #${id} still needs review (${item.review_reason})` : `application #${id} reconciled`);
    return;
  }
  const result = d.transaction(() => {
    const create = flags.create === true;
    const jobId = create ? undefined : resolveJob(d, { jobId: int(flags, "job-id"), linkedinJobId: str(flags, "linkedin-job-id") }) ?? undefined;
    const value = linkJob(d, {
      id, job_id: jobId, create: create || undefined, role_title: str(flags, "title"), company_name: str(flags, "company"),
      external_url: str(flags, "external-url"), comp: str(flags, "comp"), description: str(flags, "description"),
    });
    refreshReview(d, value.application_id);
    return value;
  })();
  await notifyChange("applications");
  await notifyChange("jobs");
  console.log(`application #${result.application_id} linked to ${result.created_job ? "new " : ""}job #${result.job_id}${result.missing.length ? `; missing for preparation: ${result.missing.join(", ")}` : ""}`);
}
