import { beforeEach, expect, test, vi } from "vitest";
import { databaseDouble } from "../test/doubles.ts";
import { executeApplicationAction, listApplicationBoard } from "./store.ts";
import type { ApplicationActions } from "./types.ts";
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: () => "2026-10-14T12:00:00.000Z",
}));
let d: ReturnType<typeof databaseDouble>;
let record: Record<string, unknown>;
let target: Record<string, unknown>;
let activeStages: Record<string, unknown>[];
let linked: boolean;
let keyed: { id: number } | undefined;
const writes = () => d.statement.run.mock.calls;
const act = (action: keyof ApplicationActions, body: unknown) =>
  executeApplicationAction(action, body, d.asDatabase);
beforeEach(() => {
  d = databaseDouble();
  record = {
    id: 1,
    stack_json: '["React"]',
    job_id: null,
    current_stage_id: 2,
    tracking_status: "active",
    submission_status: "not_submitted",
  };
  target = {
    id: 3,
    key: "technical",
    name: "Technical",
    category: "technical",
    position: 2,
    is_archived: false,
  };
  activeStages = [{ ...target, id: 2 }, target];
  linked = false;
  keyed = undefined;
  d.query.mockImplementation((sql) => ({
    ...d.statement,
    get: vi.fn((...args: unknown[]) => {
      d.statement.get(...args);
      if (sql.includes("SELECT COALESCE")) return { position: 4 };
      if (sql.includes("INSERT INTO")) return { id: 1 };
      if (sql.includes("idempotency_key = ?")) return keyed;
      if (sql.includes("SELECT id FROM applications WHERE current_stage_id"))
        return linked ? { id: 1 } : undefined;
      if (sql.includes("SELECT * FROM application_stages")) return target;
      return record;
    }),
    all: vi.fn((...args: unknown[]) => {
      d.statement.all(...args);
      return sql.includes("application_stages")
        ? activeStages
        : sql.includes("application_events")
          ? [{ event_type: "created" }]
          : [record];
    }),
    run: vi.fn((...args: unknown[]) => {
      // The journey reads the submission back before tracking the record.
      if (sql.includes("UPDATE applications SET submission_status"))
        record = { ...record, submission_status: args[0] };
      return d.statement.run(...(args as []));
    }),
  }));
});
test("lists decoded records/stages and reads details without changes", () => {
  expect(listApplicationBoard(d.asDatabase)).toEqual({
    applications: [{ ...record, stack_json: undefined, stack: ["React"] }],
    stages: activeStages,
  });
  expect(act("details", { id: 1 })).toEqual({
    value: {
      application: expect.objectContaining({ stack: ["React"] }),
      events: [{ event_type: "created" }],
    },
    changed: [],
  });
  expect(writes()).toEqual([]);
});
test("creates a minimal application and snapshots the initial stage in history", () => {
  const result = act("create", {
    company_name: " Acme ",
    external_url: "https://example.com",
    stack: [" React ", "React", ""],
  });
  expect(result.changed).toEqual(["applications", "application_events"]);
  expect(writes()).toContainEqual([
    "Acme",
    "https://example.com/",
    null,
    null,
    '["React"]',
    null,
    null,
    null,
    null,
    "2026-10-14T12:00:00.000Z",
    1,
  ]);
  // Entering the board puts the record in the initial stage.
  expect(writes()).toContainEqual([3, "2026-10-14T12:00:00.000Z", 1]);
  // A registered application is a recorded submission with a manual origin.
  expect(d.statement.get).toHaveBeenCalledWith(
    null,
    "manual",
    1,
    null,
    null,
    "2026-10-14T12:00:00.000Z",
    "2026-10-14T12:00:00.000Z",
  );
  expect(writes()).toContainEqual([
    1,
    "submission",
    "submit",
    "not_submitted",
    "submitted",
    "api",
    null,
    "2026-10-14T12:00:00.000Z",
  ]);
  expect(writes()).toContainEqual([
    1,
    "created",
    null,
    3,
    "Technical",
    "technical",
    "2026-10-14T12:00:00.000Z",
    null,
    null,
  ]);
});
test("a repeated registration with the same request ID returns the first record without writes", () => {
  keyed = { id: 1 };
  const result = act("create", {
    company_name: "Acme",
    external_url: "https://example.com",
    request_id: "form-1",
  });
  expect(result).toEqual({
    value: expect.objectContaining({ id: 1 }),
    changed: [],
  });
  expect(writes()).toEqual([]);
});
test.each([
  null,
  [],
  "text",
  {},
  { company_name: " ", external_url: "https://example.com" },
  { company_name: 1, external_url: "https://example.com" },
  { company_name: "A", external_url: "javascript:alert(1)" },
  { company_name: "A", external_url: "broken" },
])("rejects invalid creation %j", (body) => {
  expect(() => act("create", body)).toThrow();
  expect(writes()).toEqual([]);
});
test.each([
  { stack: [1] },
  { stack: "React" },
  { applied_at: "bad" },
  { role_type: "invalid" },
  { notes: 12 },
  { deadline: "2026-02-31" },
  { deadline: 20261201 },
  { company_url: "file:///tmp" },
])("rejects invalid fields %j", (fields) => {
  expect(() =>
    act("create", {
      company_name: "A",
      external_url: "https://example.com",
      ...fields,
    }),
  ).toThrow();
  expect(writes()).toEqual([]);
});
test.each([0, -1, 1.2, "1", Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid record IDs %s",
  (id) => {
    expect(() => act("details", { id })).toThrow("valid record ID");
  },
);
test("rejects missing applications/stages", () => {
  record = undefined as unknown as typeof record;
  expect(() => act("details", { id: 1 })).toThrow("Application not found");
  record = { id: 1, tracking_status: "active", current_stage_id: 2 };
  target = undefined as unknown as typeof target;
  expect(() => act("move", { id: 1, stage_id: 3 })).toThrow("Stage not found");
});
test("partial edits clear supplied optional fields and preserve omitted data", () => {
  expect(act("update", { id: 1, notes: " ", stack: [] }).changed).toEqual([
    "applications",
  ]);
  expect(d.query).toHaveBeenCalledWith(
    "UPDATE applications SET notes = ?, stack_json = ?, updated_at = ? WHERE id = ?",
  );
  expect(writes()).toEqual([[null, "[]", "2026-10-14T12:00:00.000Z", 1]]);
  expect(() => act("update", { id: 1 })).toThrow("at least one");
});
test("deadline is validated, trimmed and clearable", () => {
  act("update", { id: 1, deadline: " 2026-12-01 " });
  expect(writes()).toEqual([["2026-12-01", "2026-10-14T12:00:00.000Z", 1]]);
  act("update", { id: 1, deadline: "" });
  expect(writes()[1]).toEqual([null, "2026-10-14T12:00:00.000Z", 1]);
});
test("moves once, preserves history names and skips same-stage moves", () => {
  act("move", { id: 1, stage_id: 3, expected_stage_id: 2 });
  expect(writes()).toContainEqual([
    1,
    "moved",
    2,
    3,
    "Technical",
    "technical",
    "2026-10-14T12:00:00.000Z",
    null,
    null,
  ]);
  d.statement.run.mockClear();
  target.id = 2;
  expect(act("move", { id: 1, stage_id: 2 }).changed).toEqual([]);
  expect(writes()).toEqual([]);
});
test("rejects stale moves, hidden targets and inactive applications", () => {
  expect(() =>
    act("move", { id: 1, stage_id: 3, expected_stage_id: 4 }),
  ).toThrow("has moved");
  target.is_archived = true;
  expect(() => act("move", { id: 1, stage_id: 3 })).toThrow(
    "Restore this stage",
  );
  record.tracking_status = "archived";
  expect(() => act("move", { id: 1, stage_id: 3 })).toThrow("Reopen");
  expect(() => act("archive", { id: 1, reason: "rejected" })).toThrow("Reopen");
  expect(writes()).toEqual([]);
});
test("archives with a reason/note and reopens hidden stages", () => {
  act("archive", { id: 1, reason: "rejected", note: " reason " });
  expect(writes()).toContainEqual([
    1,
    "archived",
    2,
    3,
    "Technical",
    "technical",
    "2026-10-14T12:00:00.000Z",
    "rejected",
    "reason",
  ]);
  record.tracking_status = "archived";
  target.is_archived = true;
  expect(act("reopen", { id: 1 }).changed).toEqual([
    "applications",
    "application_events",
    "application_stages",
  ]);
  expect(writes()).toContainEqual([4, "2026-10-14T12:00:00.000Z", 3]);
  record.tracking_status = "active";
  expect(() => act("reopen", { id: 1 })).toThrow("already active");
  expect(() => act("archive", { id: 1, reason: "bad" })).toThrow(
    "archive reason",
  );
});
test("creates/renames stages while preserving category identity", () => {
  act("stages/save", { name: " New ", category: "technical" });
  expect(d.statement.get).toHaveBeenCalledWith(
    expect.any(String),
    "New",
    "technical",
    4,
    "2026-10-14T12:00:00.000Z",
    "2026-10-14T12:00:00.000Z",
  );
  act("stages/save", { id: 3, name: " Rename " });
  expect(writes()).toContainEqual(["Rename", "2026-10-14T12:00:00.000Z", 3]);
  expect(() =>
    act("stages/save", { id: 3, name: "X", category: "offer" }),
  ).toThrow("category cannot be changed");
  expect(() =>
    act("stages/save", { name: "", category: "technical" }),
  ).toThrow();
});
test.each([null, [], [2, 2], [2, 99], [2, 3, 4]])(
  "rejects incomplete/duplicate/foreign stage order %j",
  (ids) => {
    expect(() => act("stages/reorder", { ids })).toThrow("exactly once");
    expect(writes()).toEqual([]);
  },
);
test("reorders only visible stages", () => {
  activeStages.push({ ...target, id: 9, is_archived: true });
  act("stages/reorder", { ids: [3, 2] });
  expect(writes()).toEqual([
    [0, "2026-10-14T12:00:00.000Z", 3],
    [1, "2026-10-14T12:00:00.000Z", 2],
  ]);
});
test("protects initial/occupied stages and handles hide, no-op and restore", () => {
  expect(() => act("stages/set-archived", { id: 3, archived: "yes" })).toThrow(
    "boolean",
  );
  target.key = "applied";
  expect(() => act("stages/set-archived", { id: 3, archived: true })).toThrow(
    "initial stage",
  );
  target.key = "technical";
  linked = true;
  expect(() => act("stages/set-archived", { id: 3, archived: true })).toThrow(
    "active applications",
  );
  linked = false;
  expect(
    act("stages/set-archived", { id: 3, archived: false }).changed,
  ).toEqual([]);
  act("stages/set-archived", { id: 3, archived: true });
  expect(writes()).toContainEqual([1, 2, "2026-10-14T12:00:00.000Z", 3]);
  target.is_archived = true;
  act("stages/set-archived", { id: 3, archived: false });
  expect(writes()).toContainEqual([0, 4, "2026-10-14T12:00:00.000Z", 3]);
});
