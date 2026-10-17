import { db, now } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import type { Database } from "../db/sqlite.ts";
import { type Flags, str, int, reqStr } from "./flags.ts";
import { applyStatus, journeyRecord, openApplication, resolveJob, transition } from "../applications/journey-store.ts";
import { JourneyError } from "../applications/journey.ts";

/** work-tracker job save | list */
export async function jobCmd(sub: string, flags: Flags): Promise<void> {
  const d = db();
  if (sub === "list") {
    console.log(JSON.stringify(d.query("SELECT * FROM jobs ORDER BY scouted_at DESC, id DESC").all(), null, 2));
    return;
  }
  if (sub === "save") {
    const row = d.query(`
      INSERT INTO jobs (linkedin_job_id, title, company_name, location, work_type, comp, fit, requirements_json, status, link)
      VALUES ($jid, $title, $company, $location, $work, $comp, $fit, $reqs, $status, $link)
      ON CONFLICT(linkedin_job_id) DO UPDATE SET
        fit = COALESCE(excluded.fit, jobs.fit),
        status = CASE WHEN jobs.archived_at IS NULL
          THEN COALESCE(excluded.status, jobs.status) ELSE jobs.status END
      RETURNING id, archived_at
    `).get({
      $jid: str(flags, "linkedin-id") ?? null,
      $title: str(flags, "title") ?? null,
      $company: str(flags, "company") ?? null,
      $location: str(flags, "location") ?? null,
      $work: str(flags, "work-type") ?? null,
      $comp: str(flags, "comp") ?? null,
      $fit: str(flags, "fit") ?? null,
      $reqs: str(flags, "requirements") ?? null,
      $status: str(flags, "status") ?? "saved",
      $link: str(flags, "link") ?? null,
    }) as { id: number; archived_at: string | null };
    await notifyChange("jobs");
    console.log(row.archived_at ? `job #${row.id} remains archived` : `job #${row.id} saved`);
    return;
  }
  console.error(`unknown job subcommand: ${sub}`);
  process.exit(1);
}

/** work-tracker metric record */
export async function metricCmd(flags: Flags): Promise<void> {
  const d = db();
  const row = d.query(`
    INSERT INTO profile_metrics (captured_at, search_appearances, profile_views, post_impressions, connections, score, breakdown_json)
    VALUES ($at, $sa, $pv, $pi, $conn, $score, $breakdown)
    RETURNING id
  `).get({
    $at: str(flags, "at") ?? now(),
    $sa: int(flags, "search-appearances") ?? null,
    $pv: int(flags, "profile-views") ?? null,
    $pi: int(flags, "post-impressions") ?? null,
    $conn: int(flags, "connections") ?? null,
    $score: int(flags, "score") ?? null,
    $breakdown: str(flags, "breakdown") ?? null,
  }) as { id: number };
  await notifyChange("profile_metrics");
  console.log(`metric snapshot #${row.id} recorded`);
}

/** work-tracker score record — convenience that records a score-only metric row */
export async function scoreCmd(flags: Flags): Promise<void> {
  const d = db();
  const value = int(flags, "value");
  if (value === undefined) {
    console.error("error: missing --value");
    process.exit(1);
  }
  d.query(`
    INSERT INTO profile_metrics (captured_at, score, breakdown_json)
    VALUES ($at, $score, $breakdown)
  `).run({
    $at: now(),
    $score: value,
    $breakdown: str(flags, "signals") ?? null,
  });
  await notifyChange("profile_metrics");
  console.log(`score ${value} recorded`);
}

/** work-tracker interview add */
export async function interviewCmd(sub: string, flags: Flags): Promise<void> {
  const d = db();
  if (sub === "add") {
    const company = reqStr(flags, "company");
    const row = d.query(`
      INSERT INTO interviews (company, scheduled_at, stage, status, notes)
      VALUES ($company, $when, $stage, $status, $notes)
      RETURNING id
    `).get({
      $company: company,
      $when: str(flags, "when") ?? null,
      $stage: str(flags, "stage") ?? null,
      $status: str(flags, "status") ?? "scheduled",
      $notes: str(flags, "note") ?? null,
    }) as { id: number };
    await notifyChange("interviews");
    console.log(`interview #${row.id} (${company}) added`);
    return;
  }
  console.error(`unknown interview subcommand: ${sub}`);
  process.exit(1);
}

const applicationColumns: Record<string, string> = {
  portal: "portal",
  "external-url": "external_url",
  fields: "fields_filled_json",
  unfilled: "unfilled_json",
  "applied-at": "applied_at",
  "resume-path": "resume_path",
  "cover-path": "cover_letter_path",
  "report-path": "report_path",
  "keyword-score": "keyword_score",
};

/** Write provided record fields, then apply journey changes through the shared rules. */
function updateApplication(d: Database, id: number, flags: Flags): boolean {
  const entries = Object.entries(applicationColumns)
    .map(([flag, column]) => [column, flag === "keyword-score" ? int(flags, flag) : str(flags, flag)] as const)
    .filter(([, value]) => value !== undefined);
  if (entries.length)
    d.query(`UPDATE applications SET ${entries.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, value]) => value!), now(), id);
  let changed = entries.length > 0;
  if (str(flags, "resume-path") !== undefined) changed = transition(d, id, "prepare.complete", "cli").changed || changed;
  const status = str(flags, "status");
  if (status !== undefined) changed = applyStatus(d, id, status, "cli") || changed;
  return changed;
}

function fail(error: unknown): never {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

/**
 * work-tracker application add | update. `add` is idempotent: a job reuses its
 * latest application unless `--new-attempt` explicitly starts another one, and
 * `--idempotency-key` returns the application a previous call created.
 */
export async function applicationCmd(sub: string, flags: Flags): Promise<void> {
  const d = db();
  if (sub === "add") {
    let result: { id: number; created: boolean; attempt: number | null };
    try {
      result = d.transaction(() => {
        const jobId = resolveJob(d, { jobId: int(flags, "job-id"), linkedinJobId: str(flags, "linkedin-job-id") });
        const { record, created } = openApplication(d, {
          jobId,
          origin: "agent",
          newAttempt: flags["new-attempt"] === true,
          idempotencyKey: str(flags, "idempotency-key") ?? null,
        });
        updateApplication(d, record.id, flags);
        return { id: record.id, created, attempt: record.attempt };
      })();
    } catch (error) { fail(error); }
    await notifyChange("applications");
    console.log(result.created ? `application #${result.id} added` : `application #${result.id} reused (attempt ${result.attempt})`);
    return;
  }
  if (sub === "update") {
    const id = int(flags, "id");
    if (id === undefined) {
      console.error("error: missing required --id");
      process.exit(1);
    }
    if (!str(flags, "status") && !Object.keys(applicationColumns).some((flag) => str(flags, flag) !== undefined)) {
      console.error("error: nothing to update (pass --status/--portal/--external-url/--fields/--unfilled/...)");
      process.exit(1);
    }
    try {
      d.transaction(() => { journeyRecord(d, id); updateApplication(d, id, flags); })();
    } catch (error) {
      fail(error instanceof JourneyError && error.status === 404 ? new Error(`application #${id} not found`) : error);
    }
    await notifyChange("applications");
    console.log(`application #${id} updated`);
    return;
  }
  console.error(`unknown application subcommand: ${sub}`);
  process.exit(1);
}

/** work-tracker answer set | list — reusable PII/eligibility/links/EEO answer store. */
export async function answerCmd(sub: string, flags: Flags): Promise<void> {
  const d = db();
  if (sub === "set") {
    const key = reqStr(flags, "key");
    const value = str(flags, "value") ?? null;
    d.query(`
      INSERT INTO applicant_answers (key, value, category, updated_at)
      VALUES ($key, $value, $cat, $at)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        category = COALESCE(excluded.category, applicant_answers.category),
        updated_at = excluded.updated_at
    `).run({
      $key: key,
      $value: value,
      $cat: str(flags, "category") ?? "custom",
      $at: now(),
    });
    await notifyChange("applicant_answers");
    console.log(`answer '${key}' set`);
    return;
  }
  if (sub === "list") {
    const cat = str(flags, "category");
    const rows = cat
      ? d.query(`SELECT key, value, category, updated_at FROM applicant_answers WHERE category = ? ORDER BY category, key`).all(cat)
      : d.query(`SELECT key, value, category, updated_at FROM applicant_answers ORDER BY category, key`).all();
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.error(`unknown answer subcommand: ${sub}`);
  process.exit(1);
}

/** work-tracker activity log */
export async function activityCmd(flags: Flags): Promise<void> {
  const d = db();
  d.query(`
    INSERT INTO activity_log (kind, skill, summary, payload_json)
    VALUES ($kind, $skill, $summary, $payload)
  `).run({
    $kind: str(flags, "kind") ?? "skill-run",
    $skill: str(flags, "skill") ?? null,
    $summary: str(flags, "summary") ?? null,
    $payload: str(flags, "payload") ?? null,
  });
  await notifyChange("activity_log");
  console.log("activity logged");
}
