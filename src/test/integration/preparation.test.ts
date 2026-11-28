import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
vi.mock("../../mcp/search.ts", () => ({ jobDetails: vi.fn(async () => ({ description: "React developer" })) }));
import { baseResumeFile, tailorCopy, writeProfile } from "./base-profile.ts";
const home = mkdtempSync(join(tmpdir(), "work-tracker-preparation-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let service: import("../../preparation/service.ts").PreparationService;
let jobId: number;
let mode = "success";
let calls = 0;
const listeners = new Set<(event: Record<string, unknown>) => void>();
async function complete(id: string) {
  for (let i = 0; i < 300; i++) { const run = service.details({ jobId }).runs.find(r => r.id === id)!; if (run.status !== "running") return run; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Execution did not finish");
}
beforeAll(async () => {
  database = await import("../../db/index.ts");
  const { PreparationService } = await import("../../preparation/service.ts");
  writeProfile(home);
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
        tailorCopy(manifest, "Generic project", mode === "failure" ? "\\undefinedCommand" : "Tailored project");
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
  // Tailoring works on a copy: the generated base resume is unchanged.
  expect(readFileSync(baseResumeFile(home), "utf8")).toContain("Generic project with React and Node.js.");
  const store = await import("../../preparation/store.ts");
  expect(store.artifactFile(done.artifacts[1]!.id).text).toContain("Tailored project");
  expect(done.application_id).toBeTruthy();
  // A clean generated resume, tailored without layout changes, has no layout or text-layer warnings.
  expect(done.artifacts.map(a => a.warnings)).toEqual([[], []]);
}, 60000);
const layoutFixture = (next: string) => `\\documentclass[a4paper]{article}\n\\begin{document}\n\\noindent Summary line.\\par\\vspace*{\\fill}\n\\noindent Software Engineer\\par\n\\newpage\n${next}\\par\n\\end{document}\n`;
async function compiled(name: string, source: string) {
  const { compileLatex } = await import("../../preparation/latex.ts");
  const dir = join(home, "layout", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "resume.tex"), source);
  return (await compileLatex(dir, "resume.tex", "pdflatex")).path;
}
test("reviews the layout and text layer of real PDFs against their base", async () => {
  const { inspectPdf } = await import("../../preparation/latex.ts");
  const orphan = await compiled("orphan", layoutFixture("\\noindent\\hspace*{30pt}Built the thing."));
  const clean = await compiled("clean", layoutFixture("\\noindent Next entry."));
  const identity = { email: "ada@example.com" };
  const alone = (await inspectPdf(orphan, undefined, { layout: { identity } })).warnings;
  expect(alone).toEqual(expect.arrayContaining(["Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2.", "The text layer does not contain your email (ada@example.com) as text."]));
  expect((await inspectPdf(orphan, undefined, { layout: { identity, baseline: orphan } })).warnings).toEqual([]);
  expect((await inspectPdf(orphan, undefined, { layout: { identity, baseline: clean } })).warnings).toEqual(["Page 1 ends on an entry header (\u201cSoftware Engineer\u201d) whose content continues on page 2."]);
}, 60000);
test("the resume generated from the example data has no layout warnings", async ({ skip }) => {
  const { inspectPdf } = await import("../../preparation/latex.ts");
  const { documentFromData } = await import("../../resume/document.ts");
  const { renderResume } = await import("../../resume/render.ts");
  const data = JSON.parse(readFileSync(join(process.cwd(), "base", "data", "resume-data.example.json"), "utf8"));
  let example: string;
  try { example = await compiled("example", renderResume(documentFromData(data))); }
  catch (error) {
    // CI's integration job installs only texlive-latex-base; the template's packages are checked locally by smoke-apply.
    if (/LaTeX Error: File `[^']+\.sty' not found/.test(String(error))) return skip("The example template's LaTeX packages are not installed.");
    throw error;
  }
  const warnings = (await inspectPdf(example, undefined, { layout: { identity: { email: "voce@example.com", phone: "(00) 00000-0000" } } })).warnings;
  // Its en-dash date ranges, kept as in the original resume layout, are a text-layer note, not a layout problem.
  expect(warnings).toEqual([expect.stringMatching(/^2 date ranges use a non-ASCII dash \(U\+2013/)]);
}, 60000);
test("without a usable pdftotext -bbox the layout check is skipped, not failed", async () => {
  const { inspectPdf } = await import("../../preparation/latex.ts");
  const clean = await compiled("clean", layoutFixture("\\noindent Next entry."));
  const bin = join(home, "xpdf-bin");
  mkdirSync(bin, { recursive: true });
  const real = execFileSync("sh", ["-c", "command -v pdftotext"], { encoding: "utf8" }).trim();
  writeFileSync(join(bin, "pdftotext"), `#!/bin/sh\ncase "$*" in *-bbox*) echo "Unknown option -bbox" >&2; exit 99;; esac\nexec "${real}" "$@"\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  try {
    expect((await inspectPdf(clean, undefined, { layout: {} })).warnings).toEqual([expect.stringMatching(/^Layout check skipped: pdftotext could not produce word bounding boxes \(Unknown option -bbox\)/)]);
  } finally { vi.unstubAllEnvs(); }
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
  expect(() => service.fill({ runId: run.id, versionId: "other" })).toThrow("not found");
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
  writeProfile(home, { summary: "Changed base project with React and Node.js." });
  service.description({ jobId, description: "Changed job description" });
  expect(readFileSync(pdf.path)).toEqual(bytes);
  expect(service.details({ jobId }).documents!.find(v => v.id === version.id)).toMatchObject({ description: "React developer role", approvedAt: expect.any(String), usedAt: expect.any(String) });
  const regenerated = await complete(service.generate({ jobId, provider: "opencode" }).id);
  const next = service.details({ jobId }).documents!.find(v => v.runId === regenerated.id)!;
  expect(next.approvedAt).toBeNull();
  expect(next.sourceVersion).not.toBe(version.sourceVersion);
  // Filling with an unreviewed version approves it.
  await complete(service.fill({ runId: regenerated.id }).id);
  expect(service.details({ jobId }).documents!.find(v => v.id === next.id)).toMatchObject({ approvedAt: expect.any(String), usedAt: expect.any(String) });
  expect(readFileSync(pdf.path)).toEqual(bytes);
  // Return to the approved version; the final scenario confirms this exact usage.
  await complete(service.fill({ runId: run.id, reviewed: true }).id);
  writeProfile(home);
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
  // Cancelling another fill of the same execution keeps the successful one confirmable.
  mode = "wait";
  service.fill({ runId: valid.id });
  expect((await complete(valid.id)).status).toBe("waiting_for_sign_in");
  await service.cancel(valid.id);
  expect(service.details({ jobId }).applicationStatus).toBe("filled");
  mode = "success";
  service.submitted({ runId: valid.id });
  expect(service.details({ jobId }).applicationStatus).toBe("submitted");
  expect(() => service.fill({ runId: valid.id })).toThrow("already submitted");
  const frozen = database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(valid.application_id);
  expect(frozen).toMatchObject({ submitted_at: expect.any(String) });
  writeProfile(home, { summary: "Future base project with React and Node.js." });
  await service.preview();
  expect(database.db().query("SELECT * FROM application_documents WHERE application_id = ?").get(valid.application_id)).toEqual(frozen);
});
