import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { artifactFile } from "./store.ts";
import { documentsForJob } from "./documents.ts";
import { useBase } from "./use-base.ts";
import { saveTailoredVariant } from "../variants/promote.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), ...Object.fromEntries(["mkdirSync", "copyFileSync", "writeFileSync", "readFileSync"].map(name => [name, vi.fn()])) }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("./store.ts", async original => ({ ...(await original<typeof import("./store.ts")>()), artifactFile: vi.fn() }));

let d: Database;
let job: number;
const idle = vi.fn();
const preview = { id: "base-pdf", kind: "base" as const, pages: 1, warnings: ["Long line"] };
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  job = insertJob(d, { description: "React role" });
  d.exec("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json, source_version) VALUES ('base-pdf', NULL, 'base', '/artifacts/base/v1/resume.pdf', 1, 'Base text', '[]', 'v1')");
  vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("%PDF-base"));
  vi.mocked(artifactFile).mockImplementation(id => ({ path: id === "base-pdf" ? "/artifacts/base/v1/resume.pdf" : `/artifacts/applications/${job}/x/resume.pdf`, text: "Base text", artifact: { id, kind: "base", pages: 1, warnings: [] } }));
});

test("prepares the application with the base resume as it is, in review, without an agent", () => {
  const run = useBase({ jobId: job }, idle, "v1", preview);
  expect(idle).toHaveBeenCalled();
  expect(run).toMatchObject({ provider: "base-resume", model: null, status: "completed", phase: "review", recovery: { checkpoints: ["sources", "tailored", "compiled"], retryFrom: null } });
  expect(run.artifacts.map(item => [item.kind, item.warnings])).toEqual([["base", []], ["tailored", ["Long line"]]]);
  const [version] = documentsForJob(job, run.application_id);
  expect(version).toMatchObject({ runId: run.id, baseText: "Base text", text: "Base text", description: "React role", sourceVersion: "v1", variant: null, approvedAt: null });
  expect(d.query("SELECT summary FROM activity_log").get()).toEqual({ summary: "Used the base resume for Example Corp Engineer" });
  expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/report\.md$/), "Base resume used as it is, without tailoring.", { mode: 0o600 });
  // The same sources keep the execution, also after a fill recorded its agent; changed sources start a new one.
  d.query("UPDATE application_runs SET options_json = ? WHERE id = ?").run(JSON.stringify({ sourceVersion: "v1", fillProvider: "opencode", fillModel: null }), run.id);
  expect(useBase({ jobId: job }, idle, "v1", preview).id).toBe(run.id);
  d.query("UPDATE application_runs SET options_json = 'not json' WHERE id = ?").run(run.id);
  expect(useBase({ jobId: job }, idle, "v1", preview).id).not.toBe(run.id);
  expect(useBase({ jobId: job }, idle, "v2", preview).id).not.toBe(run.id);
});

test("approving the base resume does not add it to Resumes again", () => {
  const run = useBase({ jobId: job }, idle, "v1", preview);
  const [version] = documentsForJob(job, run.application_id);
  d.query("UPDATE document_versions SET approved_at = 'now' WHERE id = ?").run(version!.id);
  expect(saveTailoredVariant(version!.id)).toBeNull();
  expect(d.query("SELECT COUNT(*) AS n FROM resume_variants").get()).toEqual({ n: 0 });
});
