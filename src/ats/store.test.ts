import { beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import * as score from "./score.ts";
import { AtsError, bestByJob, documentsToScore, readBest, readJob, refreshScores, scoresForJob, tailoredDocument } from "./store.ts";

vi.mock("./score.ts", async (original) => ({ ...(await original<typeof import("./score.ts")>()) }));

let d: Database;
const NODE = "Node.js, TypeScript, PostgreSQL and Docker services";
const CSHARP = "C#, .NET, ASP.NET Core and SQL Server APIs";
const DOTNET_JOB = "Requirements:\n- C#\n- .NET\n- SQL Server\nNice to have: Docker";
const NODE_JOB = "Requisitos: Node.js, TypeScript, PostgreSQL";

function artifact(id: string, text: string, fields: { kind?: string; run?: string | null; version?: string | null } = {}) {
  d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json, source_version) VALUES (?, ?, ?, ?, 1, ?, '[]', ?)")
    .run(id, fields.run ?? null, fields.kind ?? "variant", `/artifacts/${id}.pdf`, text, fields.version ?? null);
}
function variant(id: string, name: string, text: string, fields: { status?: string; role?: string } = {}) {
  artifact(`pdf-${id}`, text);
  d.query(`INSERT INTO resume_variants (id, name, role, origin, status, pdf_artifact_id, created_at, updated_at) VALUES (?, ?, ?, 'imported', ?, ?, '2026-11-01', '2026-11-01')`)
    .run(id, name, fields.role ?? "backend", fields.status ?? "ready", `pdf-${id}`);
}
const keys = () => d.query("SELECT job_id, document_key FROM ats_scores ORDER BY job_id, document_key").all();
beforeEach(async () => { d = await memoryDatabase(); });

test("scores each ready variant and picks the best one per job", () => {
  const dotnet = insertJob(d, { description: DOTNET_JOB });
  const node = insertJob(d, { description: NODE_JOB });
  const empty = insertJob(d, { description: "Great team, Git" });
  variant("n", "Back-End · Node.js", NODE);
  variant("c", "Back-End · C#", CSHARP);
  variant("g", "Generating", CSHARP, { status: "generating" });
  const base = vi.fn(() => "v1");
  expect(readBest(d, base)).toEqual(expect.arrayContaining([
    { job_id: dotnet, document_key: "variant:c", variant_id: "c", label: "Back-End · C#", score: 90, band: "strong" },
    { job_id: node, document_key: "variant:n", variant_id: "n", label: "Back-End · Node.js", score: 100, band: "strong" },
    { job_id: empty, document_key: "variant:c", variant_id: "c", label: "Back-End · C#", score: null, band: null },
  ]));
  expect(base).not.toHaveBeenCalled();
  expect(keys()).toHaveLength(6);
});

test("recomputes only stale rows: description, PDF text or ATS_VERSION", () => {
  const job = insertJob(d, { description: DOTNET_JOB });
  variant("c", "C#", CSHARP);
  const documents = () => documentsToScore(d, () => null);
  expect(refreshScores(d, documents())).toBe(1);
  expect(refreshScores(d, documents())).toBe(0);
  d.query("UPDATE jobs SET description = ? WHERE id = ?").run(NODE_JOB, job);
  expect(refreshScores(d, documents())).toBe(1);
  expect(bestByJob(d, documents())[0]).toMatchObject({ score: 0, band: "weak" });
  d.exec(`UPDATE pdf_artifacts SET text = '${NODE}' WHERE id = 'pdf-c'`);
  expect(refreshScores(d, documents())).toBe(1);
  expect(bestByJob(d, documents())[0]).toMatchObject({ score: 100 });
  vi.spyOn(score, "ATS_VERSION", "get").mockReturnValue(2 as never);
  expect(refreshScores(d, documents())).toBe(1);
  expect(d.query("SELECT ats_version FROM ats_scores").get()).toEqual({ ats_version: 2 });
});

test("drops archived variants and uses the base preview only without variants", () => {
  const job = insertJob(d, { description: DOTNET_JOB });
  artifact("base-1", CSHARP, { kind: "base", version: "v1" });
  artifact("base-old", NODE, { kind: "base", version: "v0" });
  expect(documentsToScore(d, () => null)).toEqual([]);
  expect(readBest(d, () => "v1")).toEqual([{ job_id: job, document_key: "base:v1", variant_id: null, label: "Base resume", score: 90, band: "strong" }]);
  variant("n", "Node", NODE);
  readBest(d, () => "v1");
  expect(keys()).toEqual([{ job_id: job, document_key: "variant:n" }]);
  d.exec("UPDATE resume_variants SET archived_at = 'now'");
  expect(readBest(d, () => "v1")[0]).toMatchObject({ document_key: "base:v1" });
  expect(keys()).toEqual([{ job_id: job, document_key: "base:v1" }]);
  expect(readBest(d, () => "missing")).toEqual([]);
});

test("a job's detail also scores its latest tailored document", () => {
  const job = insertJob(d, { description: DOTNET_JOB });
  const other = insertJob(d, { description: NODE_JOB });
  variant("n", "Node", NODE);
  d.exec(`INSERT INTO applications (id, job_id) VALUES (1, ${job});
    INSERT INTO application_runs (id, job_id, application_id, status, phase, provider, created_at, updated_at) VALUES
      ('r1', ${job}, 1, 'completed', 'review', 'fake', 'now', 'now'), ('r2', ${job}, 1, 'completed', 'review', 'fake', 'now', 'now'), ('r3', ${job}, 1, 'completed', 'review', 'saved-resume', 'now', 'now');`);
  const version = (id: string, run: string, text: string, variantId: string | null = null) => {
    artifact(id, text, { kind: "tailored", run });
    d.query("INSERT INTO document_versions (id, run_id, application_id, pdf_hash, source_version, snapshot_json, created_at, variant_id) VALUES (?, ?, 1, 'h', 'v', '{}', 'now', ?)").run(id, run, variantId);
  };
  expect(tailoredDocument(d, job)).toBeNull();
  version("t1", "r1", NODE);
  version("t2", "r2", CSHARP);
  version("t3", "r3", NODE, "n");
  expect(tailoredDocument(d, job)).toMatchObject({ key: "document:t2", kind: "document", label: "Tailored resume" });
  const detail = readJob(d, job, () => null);
  expect(detail.keywords.map(keyword => keyword.term)).toEqual(["C#", ".NET", "SQL Server", "Docker"]);
  expect(detail.documents.map(item => [item.document_key, item.score, item.requiredMissing])).toEqual([["document:t2", 90, []], ["variant:n", 10, ["C#", ".NET", "SQL Server"]]]);
  expect(detail.documents[0]!.missing.map(item => item.term)).toEqual(["Docker"]);
  // Refreshing every job keeps the tailored row; a job without one keeps none.
  readBest(d, () => null);
  expect(keys()).toEqual([{ job_id: job, document_key: "document:t2" }, { job_id: job, document_key: "variant:n" }, { job_id: other, document_key: "variant:n" }]);
  expect(readJob(d, other, () => null).documents).toHaveLength(1);
});

test("reports a too-short description and rejects unknown jobs", () => {
  const job = insertJob(d, { description: "Java" });
  variant("n", "Node", NODE);
  expect(readJob(d, job, () => null).documents[0]).toMatchObject({ score: null, band: null, reason: "too_few_keywords", requiredMissing: [] });
  expect(() => readJob(d, 999, () => null)).toThrow(new AtsError("Job not found.", 404));
  expect(() => readJob(d, 0, () => null)).toThrow("Enter a valid job ID.");
  expect(scoresForJob(d, job, [])).toMatchObject({ documents: [] });
  expect(refreshScores(d, [], [])).toBe(0);
});
