import { db } from "../db/index.ts";
import { now } from "../db/index.ts";
import { dueAttempts, getBudget } from "../outreach/store.ts";
import { applicationPendingSql, pendingDeadlines, pendingLevel } from "../deadlines/queries.ts";
import { deadlineUrgency, localToday } from "../deadlines/urgency.ts";
import { applicationSummary, phaseSql, viewSql } from "../applications/journey-summary.ts";
import { quietApplications } from "../applications/quiet.ts";
import { rankingState, type RankingState } from "../rankings/list.ts";
import type { RankingStatus } from "../rankings/types.ts";

/** Ranking state of a job row, derived from its deadline on every read. */
function rankingFields(state: RankingState) {
  return { ranking_status: state.status, ranking_expired_reason: state.expired_reason, closing_soon: state.closing_soon };
}

/** Parse a breakdown_json blob into a normalized array of {label, value} items. */
function parseBreakdown(raw: string | null | undefined): Array<{ label: string; value: string }> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) {
      return obj.map((x) =>
        typeof x === "string"
          ? { label: x, value: "" }
          : { label: String(x.label ?? x.key ?? ""), value: String(x.value ?? x.status ?? "") },
      );
    }
    if (obj && typeof obj === "object") {
      return Object.entries(obj).map(([label, value]) => ({
        label,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }));
    }
  } catch {
    return [{ label: "note", value: raw }];
  }
  return null;
}

/** Read-side queries that power the dashboard REST API. */
export const queries = {
  overview() {
    const d = db();
    const latest = d
      .query(
        "SELECT score, breakdown_json FROM profile_metrics WHERE score IS NOT NULL ORDER BY captured_at DESC LIMIT 1",
      )
      .get() as { score: number; breakdown_json: string | null } | null;
    const counts = d
      .query(`
        SELECT
          (SELECT COUNT(*) FROM recruiters) AS recruiters,
          (SELECT COUNT(*) FROM recruiters WHERE status = 'accepted') AS accepted,
          (SELECT COUNT(*) FROM recruiters WHERE status = 'replied') AS replied,
          (SELECT COUNT(*) FROM interviews WHERE status != 'closed') AS interviews,
          (SELECT COUNT(*) FROM jobs WHERE archived_at IS NULL) AS jobs,
          (SELECT COUNT(*) FROM jobs WHERE archived_at IS NULL AND shortlisted_at IS NULL) AS new_jobs,
          (SELECT COUNT(*) FROM jobs WHERE archived_at IS NULL AND shortlisted_at IS NOT NULL) AS shortlisted_jobs,
          (SELECT COUNT(*) FROM applications) AS applications
      `)
      .get();
    return {
      score: latest?.score ?? null,
      breakdown: parseBreakdown(latest?.breakdown_json),
      ...(counts as object),
      journey: applicationSummary(d),
      /** Submitted applications without activity for the default sweep threshold. */
      quiet: quietApplications(d).items.length,
      deadlines: pendingDeadlines(d),
    };
  },

  /** Latest profile snapshot with parsed breakdown + whether any scan exists. */
  profileSnapshot() {
    const d = db();
    const row = d
      .query(`
        SELECT captured_at, search_appearances, profile_views, post_impressions,
               connections, score, breakdown_json
        FROM profile_metrics ORDER BY captured_at DESC LIMIT 1
      `)
      .get() as
      | {
          captured_at: string;
          search_appearances: number | null;
          profile_views: number | null;
          post_impressions: number | null;
          connections: number | null;
          score: number | null;
          breakdown_json: string | null;
        }
      | null;
    if (!row) return { hasScan: false };
    return {
      hasScan: true,
      capturedAt: row.captured_at,
      searchAppearances: row.search_appearances,
      profileViews: row.profile_views,
      postImpressions: row.post_impressions,
      connections: row.connections,
      score: row.score,
      breakdown: parseBreakdown(row.breakdown_json),
    };
  },

  recruiters() {
    return db()
      .query(`
        SELECT id, name, username, company, title, location, degree, status,
               date_contacted, accepted_at, replied_at, note, source_skill
        FROM recruiters
        ORDER BY
          CASE status WHEN 'interviewing' THEN 0 WHEN 'replied' THEN 1
                      WHEN 'accepted' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END,
          datetime(date_contacted) DESC
      `)
      .all();
  },

  /**
   * Due follow-up actions from the outreach engine, shaped for the Recruiters
   * "Sync" view. Surfaces accepted-but-no-reply (and other cadence) prompts.
   */
  recruitersDue() {
    return dueAttempts().map(({ attempt, action }) => ({
      id: attempt.id,
      name: attempt.person_name ?? attempt.person_username,
      username: attempt.person_username,
      company: attempt.company_name ?? attempt.company_urn,
      state: attempt.state,
      action: action.kind,
      reason: action.reason,
      due: attempt.next_action_due,
    }));
  },

  /** Saved jobs with their latest application attempt, when one exists. */
  jobs() {
    const today = localToday();
    const rows = db()
      .query(`
        SELECT j.id, j.linkedin_job_id, j.title, j.company_name, j.location, j.work_type,
               j.comp, j.fit, j.status, j.link, j.scouted_at, j.shortlisted_at, j.archived_at, j.description,
               j.description_guard_json, j.requirements_json, j.source, j.source_job_id, j.deadline,
               EXISTS (SELECT 1 FROM applications s WHERE s.job_id = j.id AND s.submission_status = 'submitted') AS sent,
               a.id AS application_id, a.origin AS application_origin,
               CASE WHEN a.id IS NULL THEN NULL ELSE ${phaseSql()} END AS application_phase,
               CASE WHEN a.id IS NULL THEN NULL ELSE ${viewSql()} END AS application_view,
               r.status AS ranking_saved, r.overall AS ranking_overall, r.verdict AS ranking_verdict,
               r.fetch_attempts AS ranking_attempts
        FROM jobs j
        LEFT JOIN job_rankings r ON r.job_id = j.id
        LEFT JOIN applications a ON a.id = (
          SELECT id FROM applications WHERE job_id = j.id
          ORDER BY COALESCE(attempt, 0) DESC, id DESC LIMIT 1)
        ORDER BY j.scouted_at DESC
      `)
      .all() as Array<{ id: number; deadline: string | null; sent: number; archived_at: string | null; ranking_saved: RankingStatus | null }>;
    return rows.map(({ sent, ranking_saved, ...job }) => ({
      ...job,
      ...rankingFields(rankingState(ranking_saved, job.deadline, today)),
      deadline_level: pendingLevel(job.deadline, !sent && !job.archived_at, today),
      deadline_days: sent || job.archived_at ? null : deadlineUrgency(job.deadline, today).daysLeft,
    }));
  },

  metrics() {
    return db()
      .query(`
        SELECT captured_at, search_appearances, profile_views,
               post_impressions, connections, score
        FROM profile_metrics ORDER BY captured_at ASC
      `)
      .all();
  },

  interviews() {
    return db()
      .query(`
        SELECT id, company, scheduled_at, stage, status, notes
        FROM interviews ORDER BY datetime(scheduled_at) ASC
      `)
      .all();
  },

  applications() {
    const today = localToday();
    const rows = db()
      .query(`
        SELECT a.id, a.job_id, COALESCE(a.role_title, j.title) AS job_title,
               COALESCE(a.company_name, j.company_name) AS company_name,
               a.resume_path, a.cover_letter_path, a.report_path,
               a.keyword_score, a.status, a.applied_at,
               a.portal, a.external_url, a.fields_filled_json, a.unfilled_json,
               a.origin, a.attempt, a.preparation_status, a.fill_status, a.submission_status,
               a.submitted_at, a.review_reason, a.tracking_status, j.linkedin_job_id,
               COALESCE(a.deadline, j.deadline) AS deadline, ${applicationPendingSql()} AS pending,
               ${phaseSql()} AS phase, ${viewSql()} AS view
        FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
        ORDER BY a.id DESC
      `)
      .all() as Array<{ id: number; deadline: string | null; pending: number }>;
    return rows.map(({ pending, ...row }) => ({
      ...row,
      deadline_level: pendingLevel(row.deadline, !!pending, today),
      deadline_days: pending ? deadlineUrgency(row.deadline, today).daysLeft : null,
    }));
  },

  applicationSummary() {
    return applicationSummary(db());
  },

  answers() {
    return db()
      .query(`
        SELECT key, value, category, updated_at FROM applicant_answers
        ORDER BY category, key
      `)
      .all();
  },

  activity(limit = 50) {
    return db()
      .query(`
        SELECT id, ts, kind, skill, summary FROM activity_log
        ORDER BY datetime(ts) DESC LIMIT ?
      `)
      .all(limit);
  },

  profile() {
    return db().query("SELECT * FROM profile WHERE id = 1").get() ?? null;
  },

  /**
   * Outreach overview: lifecycle funnel,
   * the due-today action queue, per-company blocked counts, and InMail budget.
   * Reuses the pure store helpers so semantics match the CLI exactly.
   */
  outreach() {
    const d = db();

    const funnelRows = d
      .query("SELECT state, COUNT(*) AS n FROM outreach_attempts GROUP BY state")
      .all() as Array<{ state: string; n: number }>;
    const funnel: Record<string, number> = {
      queued: 0,
      invited: 0,
      accepted: 0,
      followed_up: 0,
      engaged: 0,
      invite_ignored: 0,
      unresponsive: 0,
      do_not_contact: 0,
    };
    for (const r of funnelRows) funnel[r.state] = r.n;

    const due = dueAttempts(d).map(({ attempt, action }) => ({
      id: attempt.id,
      person_name: attempt.person_name,
      person_username: attempt.person_username,
      company_name: attempt.company_name,
      company_urn: attempt.company_urn,
      state: attempt.state,
      actionKind: action.kind,
      actionReason: action.reason,
    }));

    // Per-company blocked counts (only attempts currently within cooldown).
    const nowIso = now();
    const blockingRows = d
      .query(
        `SELECT company_urn, company_name, block_until FROM outreach_attempts
         WHERE state IN ('invite_ignored','unresponsive','do_not_contact')`,
      )
      .all() as Array<{ company_urn: string; company_name: string | null; block_until: string | null }>;
    const blockedMap = new Map<string, { company_name: string | null; company_urn: string; count: number }>();
    for (const r of blockingRows) {
      const active = !r.block_until || new Date(r.block_until) > new Date(nowIso);
      if (!active) continue;
      const cur = blockedMap.get(r.company_urn) ?? {
        company_name: r.company_name,
        company_urn: r.company_urn,
        count: 0,
      };
      cur.count += 1;
      blockedMap.set(r.company_urn, cur);
    }
    const blocked = [...blockedMap.values()].sort((a, b) => b.count - a.count);

    const b = getBudget(d);
    const budget = {
      plan: b.plan,
      credits_remaining: b.credits_remaining,
      reserve_floor: b.reserve_floor,
      credits_used_this_cycle: b.credits_used_this_cycle,
      inmail_monthly_allotment: b.inmail_monthly_allotment,
      inmail_rollover_cap: b.inmail_rollover_cap,
    };

    return { funnel, due, blocked, budget };
  },
};
