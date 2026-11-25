import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
vi.mock("../../mcp/search.ts", () => ({ jobDetails: vi.fn(async () => ({ description: "Synthetic role" })) }));
const home = mkdtempSync(join(tmpdir(), "work-tracker-variants-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
type Services = { preparation: import("../../preparation/service.ts").PreparationService; variants: import("../../variants/service.ts").VariantService };
let database: typeof import("../../db/index.ts");
let documents: typeof import("../../preparation/documents.ts");
let store: typeof import("../../preparation/store.ts");
let sources: typeof import("../../preparation/sources.ts");
let services: Services;
let jobId: number;
let mode: "success" | "hold" = "success";
let release: (() => void) | undefined;
const prompts: Record<string, string>[] = [];
const listeners = new Set<(event: Record<string, unknown>) => void>();
const project = join(home, "source");
const original = "\\documentclass{article}\n\\begin{document}\nGeneric project with C\\# and .NET.\n\\end{document}\n";
const acp = {
  isRunning: false,
  cancel: vi.fn(() => release?.()),
  subscribe: (fn: (event: Record<string, unknown>) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  run: async (_provider: string, _skill: string, params: Record<string, string>) => {
    prompts.push(params);
    const manifest = JSON.parse(readFileSync(params.manifestPath!, "utf8"));
    for (const listener of listeners) listener({ type: "acp-update", runId: params.runId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Tailoring" } } });
    if (mode === "hold") { await new Promise<void>(resolve => { release = resolve; }); return { status: "cancelled" as const }; }
    writeFileSync(join(manifest.project, manifest.mainFile), original.replace("Generic project", `Back-End project ${prompts.length}`));
    writeFileSync(manifest.selectionPath, JSON.stringify({ language: "en", target: manifest.target, gaps: [] }));
    writeFileSync(manifest.reportPath, "# Changes\nEmphasized .NET.");
    return { status: "done" as const };
  },
};
async function settled(id: string) {
  for (let i = 0; i < 300; i++) { const variant = services.variants.get(id); if (variant.status !== "generating") return variant; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Generation did not finish");
}
function create(): Services {
  const { PreparationService } = preparationModule;
  const preparation = new PreparationService(acp, vi.fn());
  return { preparation, variants: new variantModule.VariantService(acp, vi.fn(), preparation.slot) };
}
let preparationModule: typeof import("../../preparation/service.ts");
let variantModule: typeof import("../../variants/service.ts");
const input = { name: "Back-End · C#, .NET", role: "backend", stacks: ["C#", ".NET"], language: "en", provider: "opencode" };
beforeAll(async () => {
  database = await import("../../db/index.ts");
  documents = await import("../../preparation/documents.ts");
  store = await import("../../preparation/store.ts");
  sources = await import("../../preparation/sources.ts");
  preparationModule = await import("../../preparation/service.ts");
  variantModule = await import("../../variants/service.ts");
  mkdirSync(project);
  writeFileSync(join(project, "resume.tex"), original);
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  jobId = (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', 'Example', 'C# role', 'https://example.com/apply') RETURNING id").get() as { id: number }).id;
  services = create();
});
afterAll(async () => { await services?.preparation.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });

test("generates a validated variant once and reuses its exact PDF in Apply without the agent", async () => {
  const started = services.variants.generate(input);
  expect(started.status).toBe("generating");
  expect(() => services.preparation.generate({ jobId, provider: "opencode" })).toThrow("active execution");
  const ready = await settled(started.id);
  expect(ready).toMatchObject({ status: "ready", origin: "generated", stale: false, pdf: { kind: "variant", pages: 1 }, report: "# Changes\nEmphasized .NET." });
  expect(ready.events).toHaveLength(1);
  const manifest = JSON.parse(readFileSync(prompts[0]!.manifestPath!, "utf8"));
  expect(manifest).toMatchObject({ variantId: ready.id, target: { kind: "variant", role: "backend", stacks: ["C#", ".NET"], language: "en" }, coverPath: null });
  expect(manifest.job).toBeUndefined();
  // The base preview never resolves to the variant PDF compiled from the same sources.
  expect(store.cachedPreview(ready.sourceVersion!)?.kind).toBe("base");
  const variantHash = documents.pdfHash(store.artifactFile(ready.pdf!.id).path);
  const calls = prompts.length;
  const run = services.preparation.useVariant({ jobId, variantId: ready.id });
  expect(prompts).toHaveLength(calls);
  expect(run).toMatchObject({ status: "completed", phase: "review", provider: "saved-resume", recovery: { retryFrom: null } });
  const [version] = documents.documentsForJob(jobId, run.application_id);
  expect(version).toMatchObject({ runId: run.id, pdfHash: variantHash, variant: { id: ready.id, name: input.name, role: "backend", stacks: ["C#", ".NET"] }, extra: "" });
  expect(database.db().query("SELECT variant_id FROM document_versions WHERE id = ?").get(version!.id)).toEqual({ variant_id: ready.id });
  expect(() => services.preparation.retry({ runId: run.id })).toThrow("Generate a tailored version instead.");
  services.preparation.approve({ runId: run.id, versionId: version!.id });
  expect(documents.approvedDocument(run.id).pdfHash).toBe(variantHash);
  expect(database.db().query("SELECT preparation_status, preparation_run_id FROM applications WHERE id = ?").get(run.application_id)).toEqual({ preparation_status: "ready", preparation_run_id: run.id });
  expect(database.db().query("SELECT summary FROM activity_log ORDER BY id DESC LIMIT 1").get()).toEqual({ summary: `Used saved resume ${input.name} for Example Engineer` });

  // Regenerating keeps the approved document's PDF; changed sources mark older generations stale.
  const regenerated = await settled(services.variants.regenerate({ id: ready.id }).id);
  expect(regenerated.pdf!.id).not.toBe(ready.pdf!.id);
  expect(documents.approvedDocument(run.id).pdfHash).toBe(variantHash);
  writeFileSync(join(project, "resume.tex"), original.replace("Generic", "Changed generic"));
  expect(services.variants.get(ready.id).stale).toBe(true);
  writeFileSync(join(project, "resume.tex"), original);
}, 120000);

test("imports a ready PDF, archives variants and refuses archived ones in Apply", async () => {
  const [generated] = services.variants.list();
  const pdf = join(home, "outside.pdf");
  copyFileSync(store.artifactFile(generated!.pdf!.id).path, pdf);
  const { importVariantPdf } = await import("../../variants/import.ts");
  await expect(importVariantPdf({ name: "Imported", role: "other", stacks: "React", path: "relative.pdf" })).rejects.toThrow("Choose a PDF file.");
  const id = await importVariantPdf({ name: "Imported", role: "other", stacks: "React", path: pdf });
  expect(services.variants.get(id)).toMatchObject({ origin: "imported", status: "ready", sourceVersion: null, stale: false, pdf: { pages: 1 } });
  expect(() => services.variants.regenerate({ id })).toThrow("cannot be regenerated");
  const run = services.preparation.useVariant({ jobId, variantId: id });
  expect(documents.documentsForJob(jobId, run.application_id)[0]).toMatchObject({ baseText: expect.stringContaining("Back-End project"), variant: { id } });
  services.variants.archive({ id });
  expect(services.variants.list().map(item => item.id)).not.toContain(id);
  expect(services.variants.list({ includeArchived: true }).map(item => item.id)).toContain(id);
  expect(() => services.preparation.useVariant({ jobId, variantId: id })).toThrow("archived");
});

test("approving a resume tailored in Apply saves it in Resumes, scored and offered for other jobs", async () => {
  const insert = (title: string) => (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES (?, 'Acme', 'Requirements: C#, .NET and Angular', 'https://example.com/acme') RETURNING id").get(title) as { id: number }).id;
  const tailoredJob = insert("Desenvolvedor Full Stack .NET/Angular");
  const started = services.preparation.generate({ jobId: tailoredJob, provider: "opencode" });
  let run = store.runRecord(started.id);
  for (let i = 0; i < 300 && run.status === "running"; i++) { await new Promise(resolve => setTimeout(resolve, 100)); run = store.runRecord(started.id); }
  expect(run).toMatchObject({ status: "completed", phase: "review" });
  const [version] = documents.documentsForJob(tailoredJob, run.application_id);
  const before = services.variants.list().length;
  services.preparation.approve({ runId: run.id, versionId: version!.id });
  const saved = services.variants.list().find(item => item.source?.applicationId === run.application_id)!;
  expect(saved).toMatchObject({
    name: "Desenvolvedor Full Stack .NET/Angular", role: "fullstack", stacks: [".NET", "Angular", "C#"], status: "ready", report: "# Changes\nEmphasized .NET.",
    source: { jobId: tailoredJob, documentVersionId: version!.id, company: "Acme" }, match: { score: expect.any(Number) },
  });
  expect(services.variants.list()).toHaveLength(before + 1);
  // Its own copy, with the approved bytes.
  expect(store.artifactFile(saved.pdf!.id).path).toContain(join("variants", saved.id));
  expect(documents.pdfHash(store.artifactFile(saved.pdf!.id).path)).toBe(version!.pdfHash);
  // Approving again does not add another saved resume, and the next job with the same stack is scored against it.
  services.preparation.approve({ runId: run.id, versionId: version!.id });
  expect(services.variants.list()).toHaveLength(before + 1);
  const { readJob } = await import("../../ats/store.ts");
  const next = insert("Full Stack Engineer");
  expect(readJob(database.db(), next, variantModule.currentSourceVersion).documents.map(item => item.variant_id)).toContain(saved.id);
}, 120000);

test("cancelling leaves the variant cancelled without a PDF, and a restart interrupts a generation", async () => {
  mode = "hold";
  const started = services.variants.generate({ ...input, name: "Held" });
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 50));
  await services.variants.cancel({ id: started.id });
  expect(services.variants.get(started.id)).toMatchObject({ status: "cancelled", pdf: null });
  mode = "success";
  database.db().query("UPDATE resume_variants SET status = 'generating' WHERE id = ?").run(started.id);
  await services.preparation.close();
  services = create();
  expect(services.variants.get(started.id)).toMatchObject({ status: "interrupted", error: expect.stringContaining("Regenerate") });
}, 60000);
