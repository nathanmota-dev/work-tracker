import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { DEFAULT_APPLICATION_STAGES, SCHEMA_VERSION } from "../../db/schema.ts";
import type {
  ApplicationActions,
  ApplicationDetails,
  ApplicationStage,
  TrackedApplication,
} from "../../applications/types.ts";

const home = mkdtempSync(join(tmpdir(), "work-tracker-board-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let execute: typeof import("../../applications/store.ts").executeApplicationAction;
let list: typeof import("../../applications/store.ts").listApplicationBoard;
let handle: ReturnType<
  typeof import("../../server/index.ts").createRequestHandler
>;
const broadcast = vi.fn();
const request = (
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  token = "secret",
) =>
  handle(
    new Request(
      `http://localhost/api/application-board${path}?token=${token}`,
      {
        method,
        ...(method === "GET"
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { "content-type": "application/json" },
            }),
      },
    ),
  );
const action = <K extends keyof ApplicationActions>(
  kind: K,
  body: ApplicationActions[K],
) => execute(kind, body).value;
const create = (company_name = "Acme") =>
  action("create", {
    company_name,
    external_url: "https://jobs.example.com/role",
  }) as TrackedApplication;
const findStage = (key: string) =>
  list().stages.find((stage) => stage.key === key)!;
const details = (id: number) => action("details", { id }) as ApplicationDetails;

beforeAll(async () => {
  const legacy = new Database(join(home, "work-tracker.db"));
  legacy.exec(`CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, resume_path TEXT, cover_letter_path TEXT,
    report_path TEXT, keyword_score INTEGER, status TEXT NOT NULL DEFAULT 'draft', applied_at TEXT
  ); INSERT INTO applications (resume_path) VALUES ('/old/resume.pdf');`);
  legacy.close();
  ({ db, closeDb } = await import("../../db/index.ts"));
  ({ executeApplicationAction: execute, listApplicationBoard: list } =
    await import("../../applications/store.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({
    token: "secret",
    acp: { run: async () => {}, cancel: () => {} },
    broadcast,
  });
  db();
});
beforeEach(() => {
  db().exec(
    "DELETE FROM application_events; DELETE FROM application_transitions; DELETE FROM applications WHERE current_stage_id IS NOT NULL; DELETE FROM application_stages WHERE key NOT IN ('applied', 'recruiter', 'technical', 'offer');",
  );
  DEFAULT_APPLICATION_STAGES.forEach((stage, position) =>
    db()
      .query(
        "UPDATE application_stages SET name = ?, position = ?, is_archived = 0 WHERE key = ?",
      )
      .run(stage.name, position, stage.key),
  );
  broadcast.mockClear();
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME;
  else process.env.WORK_TRACKER_HOME = previousHome;
});

test("additive migration preserves legacy applications and is idempotent after restart", async () => {
  expect(
    db()
      .query(
        "SELECT resume_path, status, current_stage_id FROM applications WHERE id = 1",
      )
      .get(),
  ).toEqual({
    resume_path: "/old/resume.pdf",
    status: "draft",
    current_stage_id: null,
  });
  expect(list().applications).toEqual([]);
  expect(list().stages).toHaveLength(4);
  expect(
    db().query("SELECT value FROM meta WHERE key='schema_version'").get(),
  ).toEqual({ value: String(SCHEMA_VERSION) });
  const record = create();
  action("stages/save", {
    id: findStage("technical").id,
    name: "Engineering interview",
  });
  action("stages/set-archived", { id: findStage("offer").id, archived: true });
  closeDb();
  expect(list().applications).toEqual([record]);
  expect(findStage("technical").name).toBe("Engineering interview");
  expect(findStage("offer").is_archived).toBe(true);
  expect(list().stages).toHaveLength(4);
  const { queries } = await import("../../server/queries.ts");
  expect(queries.applications()).toContainEqual(
    expect.objectContaining({
      id: record.id,
      company_name: "Acme",
      status: "submitted",
      origin: "manual",
      submission_status: "submitted",
    }),
  );
});

test("minimal and duplicate registrations require no saved job or optional fields", () => {
  const first = create("  Acme  ");
  const second = create("Acme");
  expect(first).toMatchObject({
    company_name: "Acme",
    role_type: null,
    stack: [],
    comp: null,
    tracking_status: "active",
    current_stage_id: findStage("applied").id,
  });
  expect(second.id).not.toBe(first.id);
  expect(db().query("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  expect(details(first.id).events).toMatchObject([
    { event_type: "created", from_stage_id: null, stage_category: "applied" },
  ]);
});

test("partial edits clear optional fields and preserve stage, ATS status and history", () => {
  const record = action("create", {
    company_name: "Acme",
    external_url: "https://example.com/role",
    role_type: "front_end",
    role_title: "Senior",
    stack: ["React", " React ", "TypeScript"],
    comp: "US$ 80–100k/year",
    company_url: "https://acme.example.com",
    notes: "Initial",
    applied_at: "2026-01-01T10:00:00Z",
  }) as TrackedApplication;
  expect(record.stack).toEqual(["React", "TypeScript"]);
  const edited = action("update", {
    id: record.id,
    comp: null,
    stack: [],
    company_url: null,
    role_type: null,
    notes: "",
  }) as TrackedApplication;
  expect(edited).toMatchObject({
    role_title: "Senior",
    external_url: "https://example.com/role",
    comp: null,
    stack: [],
    role_type: null,
    notes: null,
    current_stage_id: record.current_stage_id,
  });
  expect(details(record.id).events).toHaveLength(1);
  expect(
    db().query("SELECT status FROM applications WHERE id = ?").get(record.id),
  ).toEqual({ status: "submitted" });
});

test("skipping, returning and repeat moves preserve actual visits and name snapshots", () => {
  const record = create();
  const technical = findStage("technical");
  const recruiter = findStage("recruiter");
  action("move", { id: record.id, stage_id: technical.id });
  expect(
    details(record.id).events.map((event) => event.stage_category),
  ).toEqual(["applied", "technical"]);
  expect(
    execute("move", { id: record.id, stage_id: technical.id }).changed,
  ).toEqual([]);
  action("stages/save", { id: technical.id, name: "Technical round 1" });
  action("move", { id: record.id, stage_id: recruiter.id });
  action("move", { id: record.id, stage_id: technical.id });
  expect(details(record.id).events.map((event) => event.stage_name)).toEqual([
    "Applied",
    "Technical interview",
    "Recruiter interview",
    "Technical round 1",
  ]);
  expect(
    db()
      .query(
        "SELECT COUNT(DISTINCT application_id) AS n FROM application_events WHERE stage_category = 'technical'",
      )
      .get(),
  ).toEqual({ n: 1 });
});

test.each(["rejected", "withdrawn", "no_response", "hired"] as const)(
  "archive outcome %s retains the last stage and reopens without deleting closure history",
  (reason) => {
    const record = create();
    const target = findStage("technical");
    action("move", { id: record.id, stage_id: target.id });
    const archived = action("archive", {
      id: record.id,
      reason,
      note: "Final feedback",
    }) as TrackedApplication;
    expect(archived).toMatchObject({
      current_stage_id: target.id,
      tracking_status: "archived",
      archive_reason: reason,
    });
    expect(archived.archived_at).toBeTruthy();
    action("stages/set-archived", { id: target.id, archived: true });
    const reopened = action("reopen", { id: record.id }) as TrackedApplication;
    expect(reopened).toMatchObject({
      current_stage_id: target.id,
      tracking_status: "active",
      archive_reason: null,
      archived_at: null,
    });
    expect(findStage("technical").is_archived).toBe(false);
    expect(findStage("technical").position).toBeGreaterThan(
      findStage("offer").position,
    );
    expect(details(record.id).events.at(-2)).toMatchObject({
      event_type: "archived",
      reason,
      note: "Final feedback",
      stage_name: "Technical interview",
    });
    expect(details(record.id).events.at(-1)?.event_type).toBe("reopened");
  },
);

test("stage management protects active records, category identity, initial column and valid order", () => {
  const record = create();
  const custom = action("stages/save", {
    name: "DSA",
    category: "assessment",
  }) as ApplicationStage;
  action("move", { id: record.id, stage_id: custom.id });
  expect(() =>
    action("stages/set-archived", { id: custom.id, archived: true }),
  ).toThrow("active applications");
  expect(() =>
    action("stages/set-archived", {
      id: findStage("applied").id,
      archived: true,
    }),
  ).toThrow("initial stage");
  expect(() =>
    action("stages/save", {
      id: custom.id,
      name: "DSA",
      category: "technical",
    }),
  ).toThrow("category cannot");
  expect(() =>
    action("stages/reorder", { ids: [custom.id, custom.id] }),
  ).toThrow("exactly once");
  const ids = list()
    .stages.map((stage) => stage.id)
    .reverse();
  action("stages/reorder", { ids });
  expect(list().stages.map((stage) => stage.id)).toEqual(ids);
  action("archive", { id: record.id, reason: "rejected" });
  action("stages/set-archived", { id: custom.id, archived: true });
  action("stages/set-archived", { id: custom.id, archived: false });
  expect(list().stages.at(-1)?.id).toBe(custom.id);
});

test("HTTP boundary validates payloads and tokens and broadcasts committed writes only", async () => {
  expect((await request("", undefined, "GET", "bad")).status).toBe(403);
  expect((await request("/create", {})).status).toBe(400);
  expect(
    (
      await request("/create", {
        company_name: "Acme",
        external_url: "file:///tmp/role",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/create", {
        company_name: "Acme",
        external_url: "https://example.com",
        role_type: "constructor",
      })
    ).status,
  ).toBe(400);
  expect((await request("/create", [])).status).toBe(400);
  expect((await request("/create", undefined)).status).toBe(405);
  expect((await request("/missing", {})).status).toBe(404);
  expect((await request("/details", { id: 99999 })).status).toBe(404);
  expect(broadcast).not.toHaveBeenCalled();
  const result = await request("/create", {
    company_name: "Acme",
    external_url: "https://example.com",
  });
  expect(result.status).toBe(201);
  const record = (await result.json()) as TrackedApplication;
  expect(broadcast.mock.calls).toEqual([
    [{ type: "changed", table: "applications" }],
    [{ type: "changed", table: "application_events" }],
  ]);
  broadcast.mockClear();
  expect(
    (
      await request("/move", {
        id: record.id,
        stage_id: record.current_stage_id,
      })
    ).status,
  ).toBe(200);
  expect(broadcast).not.toHaveBeenCalled();
  expect(
    (
      await request("/move", {
        id: record.id,
        stage_id: findStage("technical").id,
        expected_stage_id: findStage("offer").id,
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("/archive", { id: record.id, reason: "rejected" })).status,
  ).toBe(200);
  expect(
    (
      await request("/move", {
        id: record.id,
        stage_id: findStage("technical").id,
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("/archive", { id: record.id, reason: "rejected" })).status,
  ).toBe(409);
  expect((await request("/reopen", { id: record.id })).status).toBe(200);
  expect((await request("/reopen", { id: record.id })).status).toBe(409);
  const malformed = await handle(
    new Request("http://localhost/api/application-board/create?token=secret", {
      method: "POST",
      body: "bad-json",
    }),
  );
  expect(malformed.status).toBe(400);
});

test("failed history insertion rolls back the move and emits no change events", async () => {
  const record = create();
  db().exec(
    "CREATE TRIGGER fail_application_event BEFORE INSERT ON application_events BEGIN SELECT RAISE(ABORT, 'history unavailable'); END;",
  );
  try {
    await expect(
      request("/move", { id: record.id, stage_id: findStage("technical").id }),
    ).rejects.toThrow("history unavailable");
    expect(details(record.id).application.current_stage_id).toBe(
      record.current_stage_id,
    );
    expect(details(record.id).events).toHaveLength(1);
    expect(broadcast).not.toHaveBeenCalled();
  } finally {
    db().exec("DROP TRIGGER fail_application_event;");
  }
});

test("submit from the list marks a filled application submitted and tracks it once", () => {
  const { lastInsertRowid } = db().query("INSERT INTO applications (status, fill_status, company_name, role_title) VALUES ('filled', 'filled', 'Acme', 'Dev')").run();
  const id = Number(lastInsertRowid);
  const first = execute("submit", { id });
  expect(first.changed).toEqual(expect.arrayContaining(["applications", "application_events"]));
  expect(first.value).toMatchObject({ id, tracking_status: "active", submission_status: "submitted" });
  expect(list().applications.map(item => item.id)).toContain(id);
  expect(db().query("SELECT COUNT(*) AS n FROM application_events WHERE application_id = ?").get(id)).toEqual({ n: 1 });
  expect(execute("submit", { id }).changed).toEqual([]);
  expect(db().query("SELECT COUNT(*) AS n FROM application_events WHERE application_id = ?").get(id)).toEqual({ n: 1 });
});
