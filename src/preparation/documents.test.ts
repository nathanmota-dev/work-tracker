import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import { databaseDouble } from "../test/doubles.ts";
import { artifactFile, runOptions, runRecord } from "./store.ts";
import { snapshotSources } from "./sources.ts";
import { approveDocument, approvedDocument, documentsForJob, freezeDocumentUse, pdfHash, recordDocumentUse, saveDocument, verifyDocumentUse } from "./documents.ts";
import type { PreparationRun } from "./types.ts";
import type { GenerationManifest } from "./generation.ts";
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("./store.ts", () => ({ artifactFile: vi.fn(), runRecord: vi.fn(), runOptions: vi.fn() }));
vi.mock("./sources.ts", async original => ({ ...(await original<typeof import("./sources.ts")>()), snapshotSources: vi.fn() }));
let d: ReturnType<typeof databaseDouble>;
let row: Record<string, unknown>;
let run: PreparationRun;
const manifest = { runId: "r", applicationId: 2, versionId: "pdf", pdfHash: "", pdfPath: "/artifacts/resume.pdf" };
beforeEach(() => {
  d = databaseDouble(); vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockImplementation(path => String(path).endsWith(".pdf") ? Buffer.from("%PDF-original") : '{}');
  manifest.pdfHash = pdfHash(manifest.pdfPath);
  row = { id: "pdf", run_id: "r", application_id: 2, pdf_hash: manifest.pdfHash, source_version: "sources", snapshot_json: '{"baseText":"Base","description":"React","extra":"context","data":null}', text: "Tailored", created_at: "now", approved_at: "now", used_at: null, submitted_at: null };
  d.statement.all.mockImplementation(() => [row]);
  d.statement.get.mockReturnValue({ submission_status: "not_submitted", version_id: "pdf", pdf_hash: manifest.pdfHash });
  run = { id: "r", job_id: 1, application_id: 2, phase: "review", status: "completed", artifacts: [{ id: "base", kind: "base", pages: 1, warnings: [] }] } as unknown as PreparationRun;
  vi.mocked(runRecord).mockReturnValue(run);
  vi.mocked(runOptions).mockReturnValue({ extra: "context" });
  vi.mocked(artifactFile).mockReturnValue({ path: manifest.pdfPath, text: "Base", artifact: run.artifacts[0]! });
  vi.mocked(snapshotSources).mockReturnValue({ files: [{ name: "resume.tex", bytes: Buffer.from("source") }] } as ReturnType<typeof snapshotSources>);
});
test("returns version inputs and independently persisted approval and usage", () => {
  expect(documentsForJob(1, 2)[0]).toMatchObject({ id: "pdf", description: "React", extra: "context", text: "Tailored", baseText: "Base", approvedAt: "now", usedAt: null });
  expect(approvedDocument("r", "pdf").pdfHash).toBe(manifest.pdfHash);
  expect(() => approvedDocument("r", "other")).toThrow("differs");
  row.approved_at = null;
  expect(() => approvedDocument("r")).toThrow("Approve");
  d.statement.all.mockReturnValue([]);
  expect(() => approvedDocument("r")).toThrow("Approve");
});
test("approval checks execution, ownership, submission and the PDF bytes", () => {
  row.approved_at = null;
  expect(approveDocument({ runId: "r", versionId: "pdf" }).approvedAt).toBe("now");
  expect(d.statement.run).toHaveBeenCalledWith("now", "pdf");
  row.approved_at = "earlier";
  expect(approveDocument({ runId: "r", versionId: "pdf" }).approvedAt).toBe("earlier");
  run.status = "running";
  expect(() => approveDocument({ runId: "r", versionId: "pdf" })).toThrow("Finish generation");
  run.status = "completed";
  expect(() => approveDocument({ runId: "r", versionId: "other" })).toThrow("not found");
  d.statement.get.mockReturnValue({ submission_status: "submitted" });
  expect(() => approveDocument({ runId: "r", versionId: "pdf" })).toThrow("already been submitted");
  d.statement.get.mockReturnValue({ submission_status: "not_submitted" });
  vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("changed"));
  expect(() => approveDocument({ runId: "r", versionId: "pdf" })).toThrow("PDF changed");
  expect(() => approvedDocument("r")).toThrow("approved PDF changed");
});
test("validates the exact portal version, application, path and hash", () => {
  verifyDocumentUse(d.asDatabase, manifest);
  for (const change of [{ applicationId: 3 }, { pdfPath: "/other.pdf" }, { pdfHash: "wrong" }, { versionId: undefined }]) {
    expect(() => verifyDocumentUse(d.asDatabase, { ...manifest, ...change })).toThrow("differs");
  }
  d.statement.get.mockReturnValue({ submission_status: "submitted" });
  expect(() => verifyDocumentUse(d.asDatabase, manifest)).toThrow("already been submitted");
});
test("records usage and freezes it only for a matching successful fill", () => {
  recordDocumentUse(d.asDatabase, manifest);
  expect(d.statement.run).toHaveBeenCalledWith(2, "pdf", manifest.pdfHash, "now");
  freezeDocumentUse(d.asDatabase, 2, "r");
  expect(d.statement.run).toHaveBeenCalledWith("now", 2);
  run.status = "failed";
  expect(() => freezeDocumentUse(d.asDatabase, 2, "r")).toThrow("Fill the portal");
  for (const status of ["cancelled", "interrupted"] as const) {
    run.status = status;
    expect(() => freezeDocumentUse(d.asDatabase, 2, "r")).not.toThrow();
  }
  run.status = "completed";
  d.statement.get.mockReturnValue({ version_id: "other" });
  expect(() => freezeDocumentUse(d.asDatabase, 2, "r")).toThrow("Fill the portal");
  d.statement.get.mockReturnValue(undefined);
  expect(() => freezeDocumentUse(d.asDatabase, 2, "r")).toThrow("Fill the portal");
  d.statement.all.mockReturnValue([]);
  expect(() => freezeDocumentUse(d.asDatabase, 2, "r")).not.toThrow();
});
test("persists original and generated source bytes, data and generation evidence", () => {
  const generation = { job: { description: "React" }, profilePath: "/profile.json", baseProject: "/base", project: "/project", mainFile: "resume.tex", engine: "pdflatex", reportPath: "/report.md", selectionPath: "/selection.json", sourceVersion: "sources" } as unknown as GenerationManifest;
  saveDocument(d.asDatabase, "r", 2, { id: "pdf", kind: "tailored", pages: 1, warnings: [] }, generation);
  expect(d.statement.run).toHaveBeenCalledWith("pdf", "r", 2, manifest.pdfHash, "sources", expect.stringContaining('"base64":"c291cmNl"'), "now");
  vi.mocked(runOptions).mockReturnValue({});
  generation.job = {};
  vi.mocked(fs.existsSync).mockReturnValue(true);
  saveDocument(d.asDatabase, "r", 2, { id: "pdf", kind: "tailored", pages: 1, warnings: [] }, generation);
  expect(d.statement.run).toHaveBeenLastCalledWith("pdf", "r", 2, manifest.pdfHash, "sources", expect.stringContaining('"description":"","extra":""'), "now");
});
