import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { ARCHIVE_REASONS, ROLE_TYPES, STAGE_CATEGORIES } from "./types.ts";
import type {
  ApplicationActions,
  ApplicationBoard,
  ApplicationDetails,
  ApplicationEvent,
  ApplicationFields,
  ApplicationStage,
  ArchiveReason,
  TrackedApplication,
} from "./types.ts";

export class ApplicationBoardError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}
type Body = Record<string, unknown>;
type Result = {
  value:
    | TrackedApplication
    | ApplicationStage
    | ApplicationStage[]
    | ApplicationDetails;
  changed: string[];
};
const applicationColumns = `id, company_name, external_url, role_title, role_type, stack_json, comp,
  company_url, notes, applied_at, current_stage_id, tracking_status, archive_reason, archived_at, created_at, updated_at`;

function object(input: unknown): Body {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApplicationBoardError("Expected a JSON object.");
  return input as Body;
}
function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new ApplicationBoardError("Expected a valid record ID.");
  return value;
}
function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string")
    throw new ApplicationBoardError("Expected a text value.");
  return value.trim() || null;
}
function requiredText(value: unknown, label: string): string {
  const text = optionalText(value);
  if (!text) throw new ApplicationBoardError(`${label} is required.`);
  return text;
}
function webUrl(value: unknown, required = false): string | null {
  const text = required ? requiredText(value, "Job link") : optionalText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
      throw new Error();
    return url.href;
  } catch {
    throw new ApplicationBoardError("Enter a valid HTTP or HTTPS URL.");
  }
}
function choice<T extends string>(
  value: unknown,
  choices: Record<T, string>,
  label: string,
): T {
  if (typeof value !== "string" || !Object.hasOwn(choices, value))
    throw new ApplicationBoardError(`Invalid ${label}.`);
  return value as T;
}
function fields(body: Body, partial: boolean): Partial<ApplicationFields> {
  const values: Partial<ApplicationFields> = {};
  if (!partial || Object.hasOwn(body, "company_name"))
    values.company_name = requiredText(body.company_name, "Company name");
  if (!partial || Object.hasOwn(body, "external_url"))
    values.external_url = webUrl(body.external_url, true)!;
  for (const key of ["role_title", "comp", "notes"] as const) {
    if (!partial || Object.hasOwn(body, key))
      values[key] = optionalText(body[key]);
  }
  if (!partial || Object.hasOwn(body, "company_url"))
    values.company_url = webUrl(body.company_url);
  if (!partial || Object.hasOwn(body, "role_type")) {
    values.role_type =
      body.role_type == null || body.role_type === ""
        ? null
        : choice(body.role_type, ROLE_TYPES, "role type");
  }
  if (!partial || Object.hasOwn(body, "stack")) {
    const stack = body.stack ?? [];
    if (!Array.isArray(stack) || stack.some((item) => typeof item !== "string"))
      throw new ApplicationBoardError("Stack must be a list of technologies.");
    values.stack = [
      ...new Set(stack.map((item) => item.trim()).filter(Boolean)),
    ];
  }
  if (!partial || Object.hasOwn(body, "applied_at")) {
    const timestamp = optionalText(body.applied_at) ?? now();
    if (Number.isNaN(Date.parse(timestamp)))
      throw new ApplicationBoardError("Invalid application date.");
    values.applied_at = new Date(timestamp).toISOString();
  }
  return values;
}
function application(d: Database, value: unknown): TrackedApplication {
  const row = d
    .query(
      `SELECT ${applicationColumns} FROM applications WHERE id = ? AND current_stage_id IS NOT NULL`,
    )
    .get(id(value)) as
    | (Omit<TrackedApplication, "stack"> & { stack_json: string | null })
    | undefined;
  if (!row) throw new ApplicationBoardError("Application not found.", 404);
  return decodeApplication(row);
}
function decodeApplication(
  row: Omit<TrackedApplication, "stack"> & { stack_json: string | null },
): TrackedApplication {
  const { stack_json, ...rest } = row;
  return { ...rest, stack: JSON.parse(stack_json ?? "[]") as string[] };
}
function decodeStage(row: ApplicationStage): ApplicationStage {
  return { ...row, is_archived: Boolean(row.is_archived) };
}
function stage(d: Database, value: unknown): ApplicationStage {
  const row = d
    .query("SELECT * FROM application_stages WHERE id = ?")
    .get(id(value)) as ApplicationStage | undefined;
  if (!row) throw new ApplicationBoardError("Stage not found.", 404);
  return decodeStage(row);
}
function stages(d: Database): ApplicationStage[] {
  return (
    d
      .query("SELECT * FROM application_stages ORDER BY position, id")
      .all() as ApplicationStage[]
  ).map(decodeStage);
}
function requireActive(record: TrackedApplication) {
  if (record.tracking_status !== "active")
    throw new ApplicationBoardError(
      "Reopen this application before changing its stage or archiving it.",
      409,
    );
}
function event(
  d: Database,
  record: TrackedApplication,
  target: ApplicationStage,
  type: ApplicationEvent["event_type"],
  from: number | null,
  reason: ArchiveReason | null = null,
  note: string | null = null,
) {
  d.query(
    `INSERT INTO application_events
    (application_id, event_type, from_stage_id, to_stage_id, stage_name, stage_category, occurred_at, reason, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    type,
    from,
    target.id,
    target.name,
    target.category,
    now(),
    reason,
    note,
  );
}
function nextPosition(d: Database): number {
  return (
    d
      .query(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM application_stages WHERE is_archived = 0",
      )
      .get() as { position: number }
  ).position;
}
export function listApplicationBoard(d = db()): ApplicationBoard {
  return d.transaction(() => {
    const rows = d
      .query(
        `SELECT ${applicationColumns} FROM applications WHERE current_stage_id IS NOT NULL
      ORDER BY applied_at DESC, id DESC`,
      )
      .all() as (Omit<TrackedApplication, "stack"> & {
      stack_json: string | null;
    })[];
    return { stages: stages(d), applications: rows.map(decodeApplication) };
  })();
}
export function executeApplicationAction(
  action: keyof ApplicationActions,
  input: unknown,
  d = db(),
): Result {
  const body = object(input);
  if (action === "details") {
    return d.transaction(() => {
      const record = application(d, body.id);
      return {
        value: {
          application: record,
          events: d
            .query(
              "SELECT * FROM application_events WHERE application_id = ? ORDER BY occurred_at, id",
            )
            .all(record.id) as ApplicationEvent[],
        },
        changed: [],
      };
    })();
  }
  return d.transaction((): Result => {
    if (action === "create") {
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
      return { value: record, changed: ["applications", "application_events"] };
    }
    if (action === "stages/save") {
      const name = requiredText(body.name, "Stage name");
      if (body.id !== undefined) {
        const current = stage(d, body.id);
        if (body.category !== undefined && body.category !== current.category)
          throw new ApplicationBoardError(
            "A stage's category cannot be changed.",
            409,
          );
        d.query(
          "UPDATE application_stages SET name = ?, updated_at = ? WHERE id = ?",
        ).run(name, now(), current.id);
        return { value: stage(d, current.id), changed: ["application_stages"] };
      }
      const category = choice(
        body.category,
        STAGE_CATEGORIES,
        "stage category",
      );
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
    if (action === "stages/reorder") {
      const ids = body.ids;
      const active = stages(d).filter((item) => !item.is_archived);
      if (
        !Array.isArray(ids) ||
        ids.length !== active.length ||
        new Set(ids).size !== ids.length ||
        ids.some((value) => !active.some((item) => item.id === value))
      ) {
        throw new ApplicationBoardError(
          "Provide every visible stage ID exactly once.",
        );
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
    if (action === "stages/set-archived") {
      const current = stage(d, body.id);
      if (typeof body.archived !== "boolean")
        throw new ApplicationBoardError("Expected an archived boolean.");
      if (body.archived && current.key === "applied")
        throw new ApplicationBoardError(
          "The initial stage must stay available.",
          409,
        );
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
      if (current.is_archived === body.archived)
        return { value: current, changed: [] };
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
    const current = application(d, body.id);
    if (action === "update") {
      const data = fields(body, true);
      const entries = Object.entries(data);
      if (!entries.length)
        throw new ApplicationBoardError(
          "Provide at least one application field to update.",
        );
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
    if (action === "move") {
      requireActive(current);
      if (
        body.expected_stage_id !== undefined &&
        id(body.expected_stage_id) !== current.current_stage_id
      )
        throw new ApplicationBoardError(
          "This application has moved. Refresh and try again.",
          409,
        );
      const target = stage(d, body.stage_id);
      if (target.is_archived)
        throw new ApplicationBoardError(
          "Restore this stage before moving an application into it.",
          409,
        );
      if (target.id === current.current_stage_id)
        return { value: current, changed: [] };
      d.query(
        "UPDATE applications SET current_stage_id = ?, updated_at = ? WHERE id = ?",
      ).run(target.id, now(), current.id);
      event(d, current, target, "moved", current.current_stage_id);
    } else if (action === "archive") {
      requireActive(current);
      const reason = choice(body.reason, ARCHIVE_REASONS, "archive reason");
      const note = optionalText(body.note);
      const at = now();
      d.query(
        "UPDATE applications SET tracking_status = 'archived', archive_reason = ?, archived_at = ?, updated_at = ? WHERE id = ?",
      ).run(reason, at, at, current.id);
      event(
        d,
        current,
        stage(d, current.current_stage_id),
        "archived",
        current.current_stage_id,
        reason,
        note,
      );
    } else if (action === "reopen") {
      if (current.tracking_status !== "archived")
        throw new ApplicationBoardError(
          "This application is already active.",
          409,
        );
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
          "applications",
          "application_events",
          ...(target.is_archived ? ["application_stages"] : []),
        ],
      };
    }
    return {
      value: application(d, current.id),
      changed: ["applications", "application_events"],
    };
  })();
}
