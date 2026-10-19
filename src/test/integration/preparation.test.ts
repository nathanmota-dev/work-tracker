import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
vi.mock("../../mcp/search.ts", () => ({ jobDetails: vi.fn(async () => ({ description: "React developer" })) }));
const home = mkdtempSync(join(tmpdir(), "work-tracker-preparation-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let service: import("../../preparation/service.ts").PreparationService;
let sources: typeof import("../../preparation/sources.ts");
let jobId: number;
let mode = "success";
let calls = 0;
const listeners = new Set<(event: Record<string, unknown>) => void>();
const project = join(home, "source");
const original = '\\documentclass{article}\n% Future certification, not earned\n\\begin{document}\nGeneric project with React and Node.js.\n\\end{document}\n';
async function complete(id: string) {
  for (let i = 0; i < 300; i++) { const run = service.details({ jobId }).runs.find(r => r.id === id)!; if (run.status !== "running") return run; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Execution did not finish");
}
beforeAll(async () => {
  database = await import("../../db/index.ts");
  sources = await import("../../preparation/sources.ts");
  const { PreparationService } = await import("../../preparation/service.ts");
  mkdirSync(project);
  writeFileSync(join(project, "resume.tex"), original);
  writeFileSync(join(project, "asset.txt"), "auxiliary asset");
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  jobId = (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', 'Example', 'React developer role', 'https://example.com/apply') RETURNING id").get() as { id: number }).id;
  service = new PreparationService({
    isRunning: false, cancel: vi.fn(), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    run: async (_provider, skill, params) => {
      calls++;
      const manifest = JSON.parse(readFileSync(params.manifestPath!, "utf8"));
      for (const listener of listeners) listener({ type: "acp-update", source: "apply", runId: params.runId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working on this job" } } });
      if (mode === "wait") return { status: "waiting_for_sign_in" };
      if (skill === "portal-filler") {
        writeFileSync(manifest.resultPath, JSON.stringify({ versionId: mode === "divergent" ? "other" : manifest.versionId, pdfHash: manifest.pdfHash, pdfPath: manifest.pdfPath, fields: { resume: manifest.pdfPath }, unfilled: [], externalUrl: manifest.url, portal: "generic" }));
      } else {
        writeFileSync(join(manifest.project, manifest.mainFile), mode === "failure" ? original.replace('Generic project', '\\undefinedCommand') : original.replace('Generic project', 'Tailored project'));
        writeFileSync(manifest.selectionPath, JSON.stringify({ language: "en", selectedProjects: ["React"] }));
        writeFileSync(manifest.reportPath, "# Changes\nEmphasized React.");
      }
      return { status: "done" };
    },
  }, vi.fn());
});
afterAll(async () => { await service?.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });
test("compiles a preview and a job-specific PDF, preserving sources and registering the application", async () => {
  const preview = await service.preview();
  expect(preview.pages).toBe(1);
  const run = service.generate({ jobId, provider: "opencode" });
  expect(() => service.generate({ jobId, provider: "opencode" })).toThrow("active execution");
  const done = await complete(run.id);
  expect(done.status).toBe("completed");
  expect(done.artifacts.map(a => a.kind)).toEqual(["base", "tailored"]);
  expect(done.events).toHaveLength(1);
  expect(readFileSync(join(project, "resume.tex"), "utf8")).toBe(original);
  const store = await import("../../preparation/store.ts");
  expect(store.artifactFile(done.artifacts[1]!.id).text).toContain("Tailored project");
  const manifest = store.runManifest(run.id);
  expect(readFileSync(join(manifest.project, "asset.txt"), "utf8")).toBe("auxiliary asset");
  expect(done.application_id).toBeTruthy();
}, 60000);
test("fills with the selected PDF and keeps the application ID; submission is explicit", async () => {
  const prior = service.details({ jobId }).runs[0]!;
  const regenerated = await complete(service.generate({ jobId, provider: "opencode" }).id);
  expect(regenerated.application_id).toBe(prior.application_id);
  const version = service.details({ jobId }).documents!.find(v => v.runId === prior.id)!;
  service.approve({ runId: prior.id, versionId: version.id });
  const filling = service.fill({ runId: prior.id });
  const done = await complete(filling.id);
  expect(done.status).toBe("completed");
  expect(done.application_id).toBe(prior.application_id);
  expect(service.details({ jobId }).applicationStatus).toBe("filled");
  const stored = database.db().query("SELECT preparation_run_id, resume_path FROM applications WHERE id = ?").get(prior.application_id) as { preparation_run_id: string; resume_path: string };
  expect(stored.preparation_run_id).toBe(prior.id);
  expect(stored.resume_path).toContain(prior.id);
}, 60000);
test("a retained sign-in session remains cancellable", async () => {
  mode = "wait";
  const run = service.details({ jobId }).runs.find(r => r.id === service.details({ jobId }).uploadedRunId)!;
  service.fill({ runId: run.id });
  expect((await complete(run.id)).status).toBe("waiting_for_sign_in");
  await service.cancel(run.id);
  expect(service.details({ jobId }).runs.find(r => r.id === run.id)?.status).toBe("cancelled");
  mode = "success";
});
test("one correction attempt is bounded, and a failure preserves the last validated PDF", async () => {
  mode = "failure";
  calls = 0;
  const previous = database.db().query("SELECT resume_path FROM applications ORDER BY id DESC LIMIT 1").get();
  const run = service.generate({ jobId, provider: "opencode" });
  const failed = await complete(run.id);
  expect(failed.status).toBe("failed");
  expect(calls).toBe(2);
  expect(database.db().query("SELECT resume_path FROM applications ORDER BY id DESC LIMIT 1").get()).toEqual(previous);
  mode = "success";
}, 60000);
test("approval binds the portal receipt to the exact PDF and freezes submitted inputs", async () => {
  const store = await import("../../preparation/store.ts");
  const run = await complete(service.generate({ jobId, provider: "opencode", extra: "Emphasize React" }).id);
  const version = service.details({ jobId }).documents!.find(v => v.runId === run.id)!;
  expect(version).toMatchObject({ approvedAt: null, description: "React developer role", extra: "Emphasize React" });
  expect(() => service.fill({ runId: run.id })).toThrow("Approve");
  service.approve({ runId: run.id, versionId: version.id });
  expect(() => service.fill({ runId: run.id, versionId: "other" })).toThrow("differs");
  const pdf = store.artifactFile(version.id);
  const bytes = readFileSync(pdf.path);
  writeFileSync(pdf.path, "%PDF-modified");
  expect(() => service.fill({ runId: run.id })).toThrow("approved PDF changed");
  writeFileSync(pdf.path, bytes);
  const filled = await complete(service.fill({ runId: run.id, versionId: version.id }).id);
  expect(filled.status).toBe("completed");
  const app = database.db().query("SELECT resume_path, fields_filled_json FROM applications WHERE id = ?").get(run.application_id) as { resume_path: string; fields_filled_json: string };
  expect(app.resume_path).toBe(pdf.path);
  expect(JSON.parse(app.fields_filled_json).resume).toBe(pdf.path);
  expect(readFileSync(app.resume_path)).toEqual(bytes);
  const priorUsage = database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(run.application_id);
  mode = "divergent";
  expect((await complete(service.fill({ runId: run.id }).id)).status).toBe("failed");
  expect(database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(run.application_id)).toEqual(priorUsage);
  expect(() => service.submitted({ runId: run.id })).toThrow("Fill the portal");
  mode = "success";
  await complete(service.fill({ runId: run.id, reviewed: true }).id);
  writeFileSync(join(project, "resume.tex"), original.replace("Generic", "Changed base"));
  service.description({ jobId, description: "Changed job description" });
  expect(readFileSync(pdf.path)).toEqual(bytes);
  expect(service.details({ jobId }).documents!.find(v => v.id === version.id)).toMatchObject({ description: "React developer role", approvedAt: expect.any(String), usedAt: expect.any(String) });
  const regenerated = await complete(service.generate({ jobId, provider: "opencode" }).id);
  const next = service.details({ jobId }).documents!.find(v => v.runId === regenerated.id)!;
  expect(next.approvedAt).toBeNull();
  expect(next.sourceVersion).not.toBe(version.sourceVersion);
  expect(() => service.fill({ runId: regenerated.id })).toThrow("Approve");
  expect(readFileSync(pdf.path)).toEqual(bytes);
  // Return to the approved version; the final scenario confirms this exact usage.
  await complete(service.fill({ runId: run.id, reviewed: true }).id);
  writeFileSync(join(project, "resume.tex"), original);
}, 60000);
test("a failed version write rolls back registration and preserves the previous application", async () => {
  const prior = database.db().query("SELECT resume_path, preparation_run_id FROM applications ORDER BY id DESC LIMIT 1").get();
  const versions = database.db().query("SELECT id FROM document_versions").all();
  database.db().exec("CREATE TRIGGER fail_document BEFORE INSERT ON document_versions BEGIN SELECT RAISE(ABORT, 'fixture write failed'); END;");
  const failed = await complete(service.generate({ jobId, provider: "opencode" }).id);
  database.db().exec("DROP TRIGGER fail_document");
  expect(failed.status).toBe("failed");
  expect(failed.artifacts.map(a => a.kind)).toEqual(["base"]);
  expect(database.db().query("SELECT id FROM document_versions").all()).toEqual(versions);
  expect(database.db().query("SELECT resume_path, preparation_run_id FROM applications ORDER BY id DESC LIMIT 1").get()).toEqual(prior);
}, 60000);
test("rejects archived jobs and unsafe artifact paths", async () => {
  database.db().query("UPDATE jobs SET archived_at = ? WHERE id = ?").run("2026-01-01", jobId);
  expect(() => service.generate({ jobId, provider: "opencode" })).toThrow("Restore");
  const { pdfBytes } = await import("../../preparation/store.ts");
  expect(() => pdfBytes("../../config.json")).toThrow("PDF not found");
  database.db().query("UPDATE jobs SET archived_at = NULL WHERE id = ?").run(jobId);
});

test("cancellation preserves the last completed application, and submission is explicit", async () => {
  const run = service.generate({ jobId, provider: "opencode" });
  await service.cancel(run.id);
  expect(service.details({ jobId }).runs.find(r => r.id === run.id)?.status).toBe("cancelled");
  expect(service.details({ jobId }).applicationStatus).toBe("filled");
  const state = service.details({ jobId });
  const valid = state.runs.find(r => r.id === state.uploadedRunId)!;
  service.submitted({ runId: valid.id });
  expect(service.details({ jobId }).applicationStatus).toBe("submitted");
  expect(() => service.fill({ runId: valid.id })).toThrow("already submitted");
  const frozen = database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(valid.application_id);
  expect(frozen).toMatchObject({ submitted_at: expect.any(String) });
  writeFileSync(join(project, "resume.tex"), original.replace("Generic", "Future base"));
  await service.preview();
  expect(database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(valid.application_id)).toEqual(frozen);
});
