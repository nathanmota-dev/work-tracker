import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { ARCHIVE_REASONS, STAGE_CATEGORIES } from "./types.ts";
import type {
  ApplicationActions,
  ApplicationBoard,
  ApplicationDetails,
  ApplicationFields,
  ApplicationStage,
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
} from "./records.ts";
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
    | ApplicationDetails;
  changed: string[];
};
type Handler = (d: Database, body: Body) => Result;
const trackedChanges = ["applications", "application_events"];

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
function create(d: Database, body: Body): Result {
  const data = fields(body, false) as ApplicationFields;
  const initial = d
    .query("SELECT * FROM application_stages WHERE key = 'applied'")
    .get() as ApplicationStage;
  const at = now();
  const row = d
    .query(
      `INSERT INTO applications (company_name, external_url, role_title, role_type,
    stack_json, comp, company_url, notes, applied_at, status, current_stage_id, tracking_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, 'active', ?, ?) RETURNING id`,
    )
    .get(
      data.company_name,
      data.external_url,
      data.role_title,
      data.role_type,
      JSON.stringify(data.stack),
      data.comp,
      data.company_url,
      data.notes,
      data.applied_at,
      initial.id,
      at,
      at,
    ) as { id: number };
  const record = application(d, row.id);
  event(d, record, initial, "created", null);
  return { value: record, changed: [...trackedChanges] };
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
function archive(d: Database, body: Body): Result {
  const current = application(d, body.id);
  requireActive(current);
  const reason = choice(body.reason, ARCHIVE_REASONS, "archive reason");
  const note = optionalText(body.note);
  const at = now();
  d.query(
    "UPDATE applications SET tracking_status = 'archived', archive_reason = ?, archived_at = ?, updated_at = ? WHERE id = ?",
  ).run(reason, at, at, current.id);
  const target = stage(d, current.current_stage_id);
  event(d, current, target, "archived", current.current_stage_id, reason, note);
  return { value: application(d, current.id), changed: [...trackedChanges] };
}
function reopen(d: Database, body: Body): Result {
  const current = application(d, body.id);
  if (current.tracking_status !== "archived")
    throw new ApplicationBoardError("This application is already active.", 409);
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
  "stages/save": saveStage,
  "stages/reorder": reorderStages,
  "stages/set-archived": setStageArchived,
  update,
  move,
  archive,
  reopen,
};

export function executeApplicationAction(
  action: keyof ApplicationActions,
  input: unknown,
  d = db(),
): Result {
  const body = object(input);
  return d.transaction(() => handlers[action](d, body))();
}
