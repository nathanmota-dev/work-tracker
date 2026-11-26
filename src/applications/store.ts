import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { STAGE_CATEGORIES } from "./types.ts";
import type {
  ApplicationActions,
  ApplicationBoard,
  ApplicationDetails,
  ApplicationFields,
  ApplicationStage,
  JobLinkOptions,
  JobLinkResult,
  PortalLinkResult,
  QuietApplications,
  QuietResolution,
  ReviewItem,
  TrackedApplication,
} from "./types.ts";
import {
  application,
  applicationEvents,
  applications,
  event,
  nextPosition,
  requireActive,
  stage,
  stages,
  requireTracking,
} from "./records.ts";
import { openApplication, resolveJob, startTracking, transition } from "./journey-store.ts";
import { jobLinkOptions, linkJob } from "./job-link.ts";
import { savePortalLink } from "./portal-link.ts";
import { archive, trackedChanges } from "./archive.ts";
import { submit } from "./submit.ts";
import { quietApplications, quietDays } from "./quiet.ts";
import { resolveQuiet } from "./quiet-resolve.ts";
import { reconcileReviews, refreshReview, resolveReview, reviewItems } from "./review.ts";
import {
  ApplicationBoardError,
  choice,
  fields,
  id,
  object,
  optionalText,
  requiredText,
  type Body,
} from "./validation.ts";

export { ApplicationBoardError } from "./validation.ts";

type Result = {
  value:
    | TrackedApplication
    | ApplicationStage
    | ApplicationStage[]
    | ApplicationDetails
    | JobLinkOptions
    | JobLinkResult
    | PortalLinkResult
    | QuietApplications
    | QuietResolution
    | { items: ReviewItem[]; fixed?: number[] }
    | { item: ReviewItem | null };
  changed: string[];
};
type Handler = (d: Database, body: Body) => Result;

export function listApplicationBoard(d = db()): ApplicationBoard {
  return d.transaction(() => ({
    stages: stages(d),
    applications: applications(d),
  }))();
}

function details(d: Database, body: Body): Result {
  const record = application(d, body.id);
  return {
    value: { application: record, events: applicationEvents(d, record.id) },
    changed: [],
  };
}
const cardColumns = ["company_name", "external_url", "role_title", "role_type", "stack_json", "comp", "company_url", "notes", "deadline", "applied_at"] as const;
type CardRow = Record<(typeof cardColumns)[number], string | null>;

/**
 * Register an application sent outside the app. With `job_id`, the saved job's
 * existing application is reused (its stored card fields win), so changing
 * screens never creates a second application for the same job.
 */
function create(d: Database, body: Body): Result {
  const data = fields(body, false) as ApplicationFields;
  const jobId = body.job_id == null ? null : resolveJob(d, { jobId: id(body.job_id) });
  const { record: opened, created } = openApplication(d, {
    jobId,
    origin: "manual",
    idempotencyKey: optionalText(body.request_id),
  });
  if (!created && opened.tracking_status !== null) return { value: application(d, opened.id), changed: [] };
  const input: CardRow = { ...data, stack_json: JSON.stringify(data.stack) };
  const stored = d.query(`SELECT ${cardColumns.join(", ")} FROM applications WHERE id = ?`).get(opened.id) as CardRow;
  const values = cardColumns.map((column) => (created ? input[column] : stored[column] ?? input[column]));
  d.query(`UPDATE applications SET ${cardColumns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`).run(...values, opened.id);
  // Registering an application sent outside the app records its submission.
  transition(d, opened.id, "submit", "api", { at: data.applied_at });
  startTracking(d, opened.id);
  refreshReview(d, opened.id);
  return { value: application(d, opened.id), changed: [...trackedChanges] };
}
const linkOptions: Handler = (d, body) => ({ value: jobLinkOptions(d, body), changed: [] });
function link(d: Database, body: Body): Result {
  const value = linkJob(d, body);
  refreshReview(d, value.application_id);
  return { value, changed: ["applications", "jobs", "activity_log"] };
}
const review: Handler = (d) => ({ value: { items: reviewItems(d) }, changed: [] });
function resolve(d: Database, body: Body): Result {
  const { item, changed } = resolveReview(d, body, "api");
  return { value: { item }, changed: changed ? [...trackedChanges] : [] };
}
function reconcile(d: Database): Result {
  const value = reconcileReviews(d, "api");
  return { value, changed: value.fixed.length ? [...trackedChanges] : [] };
}
function saveStage(d: Database, body: Body): Result {
  const name = requiredText(body.name, "Stage name");
  if (body.id !== undefined) {
    const current = stage(d, body.id);
    if (body.category !== undefined && body.category !== current.category)
      throw new ApplicationBoardError("A stage's category cannot be changed.", 409);
    d.query(
      "UPDATE application_stages SET name = ?, updated_at = ? WHERE id = ?",
    ).run(name, now(), current.id);
    return { value: stage(d, current.id), changed: ["application_stages"] };
  }
  const category = choice(body.category, STAGE_CATEGORIES, "stage category");
  const at = now();
  const row = d
    .query(
      "INSERT INTO application_stages (key, name, category, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .get(randomUUID(), name, category, nextPosition(d), at, at) as {
    id: number;
  };
  return { value: stage(d, row.id), changed: ["application_stages"] };
}
function reorderStages(d: Database, body: Body): Result {
  const ids = body.ids;
  const active = stages(d).filter((item) => !item.is_archived);
  if (
    !Array.isArray(ids) ||
    ids.length !== active.length ||
    new Set(ids).size !== ids.length ||
    ids.some((value) => !active.some((item) => item.id === value))
  ) {
    throw new ApplicationBoardError("Provide every visible stage ID exactly once.");
  }
  ids.forEach((value, position) =>
    d
      .query(
        "UPDATE application_stages SET position = ?, updated_at = ? WHERE id = ?",
      )
      .run(position, now(), value),
  );
  return { value: stages(d), changed: ["application_stages"] };
}
function setStageArchived(d: Database, body: Body): Result {
  const current = stage(d, body.id);
  if (typeof body.archived !== "boolean")
    throw new ApplicationBoardError("Expected an archived boolean.");
  if (body.archived && current.key === "applied")
    throw new ApplicationBoardError("The initial stage must stay available.", 409);
  if (
    body.archived &&
    d
      .query(
        "SELECT id FROM applications WHERE current_stage_id = ? AND tracking_status = 'active' LIMIT 1",
      )
      .get(current.id)
  ) {
    throw new ApplicationBoardError(
      "Move or archive active applications before hiding this stage.",
      409,
    );
  }
  if (current.is_archived === body.archived) return { value: current, changed: [] };
  d.query(
    "UPDATE application_stages SET is_archived = ?, position = ?, updated_at = ? WHERE id = ?",
  ).run(
    body.archived ? 1 : 0,
    body.archived ? current.position : nextPosition(d),
    now(),
    current.id,
  );
  return { value: stage(d, current.id), changed: ["application_stages"] };
}
function update(d: Database, body: Body): Result {
  const current = application(d, body.id);
  const entries = Object.entries(fields(body, true));
  if (!entries.length)
    throw new ApplicationBoardError("Provide at least one application field to update.");
  const columns = entries.map(
    ([key]) => `${key === "stack" ? "stack_json" : key} = ?`,
  );
  const values = entries.map(([key, value]) =>
    key === "stack" ? JSON.stringify(value) : (value as string | null),
  );
  d.query(
    `UPDATE applications SET ${columns.join(", ")}, updated_at = ? WHERE id = ?`,
  ).run(...values, now(), current.id);
  return { value: application(d, current.id), changed: ["applications"] };
}
const portalLink: Handler = (d, body) => ({ value: savePortalLink(d, body), changed: ["applications"] });
function move(d: Database, body: Body): Result {
  const current = application(d, body.id);
  requireActive(current);
  if (
    body.expected_stage_id !== undefined &&
    id(body.expected_stage_id) !== current.current_stage_id
  )
    throw new ApplicationBoardError("This application has moved. Refresh and try again.", 409);
  const target = stage(d, body.stage_id);
  if (target.is_archived)
    throw new ApplicationBoardError(
      "Restore this stage before moving an application into it.",
      409,
    );
  if (target.id === current.current_stage_id) return { value: current, changed: [] };
  d.query(
    "UPDATE applications SET current_stage_id = ?, updated_at = ? WHERE id = ?",
  ).run(target.id, now(), current.id);
  event(d, current, target, "moved", current.current_stage_id);
  return { value: application(d, current.id), changed: [...trackedChanges] };
}
function quiet(d: Database, body: Body): Result {
  return { value: quietApplications(d, { days: quietDays(body.days) }), changed: [] };
}
function quietResolve(d: Database, body: Body): Result {
  const value = resolveQuiet(d, { ids: body.ids, days: quietDays(body.days) });
  return { value, changed: value.resolved.length ? [...trackedChanges] : [] };
}
function reopen(d: Database, body: Body): Result {
  const current = application(d, body.id);
  requireTracking(current, "reopen");
  const target = stage(d, current.current_stage_id);
  if (target.is_archived) {
    d.query(
      "UPDATE application_stages SET is_archived = 0, position = ?, updated_at = ? WHERE id = ?",
    ).run(nextPosition(d), now(), target.id);
  }
  d.query(
    "UPDATE applications SET tracking_status = 'active', archive_reason = NULL, archived_at = NULL, updated_at = ? WHERE id = ?",
  ).run(now(), current.id);
  event(d, current, target, "reopened", current.current_stage_id);
  return {
    value: application(d, current.id),
    changed: [
      ...trackedChanges,
      ...(target.is_archived ? ["application_stages"] : []),
    ],
  };
}

const handlers: Record<keyof ApplicationActions, Handler> = {
  details,
  create,
  "link/options": linkOptions,
  link,
  review,
  "review/resolve": resolve,
  "review/reconcile": reconcile,
  "stages/save": saveStage,
  "stages/reorder": reorderStages,
  "stages/set-archived": setStageArchived,
  update,
  "portal-link": portalLink,
  move,
  archive,
  submit,
  reopen,
  quiet,
  "quiet/resolve": quietResolve,
};

export function executeApplicationAction(
  action: keyof ApplicationActions,
  input: unknown,
  d = db(),
): Result {
  const body = object(input);
  return d.transaction(() => handlers[action](d, body))();
}
