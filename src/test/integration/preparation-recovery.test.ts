import { beforeAll, afterAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparationAgent, PreparationService } from "../../preparation/service.ts";
import type { PreparationRun } from "../../preparation/types.ts";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
vi.mock("../../mcp/search.ts", () => ({ jobDetails: vi.fn(async () => ({ description: "React developer" })) }));
// Compiling a tailored project can be held to simulate the app closing while LaTeX runs.
const compile = vi.hoisted(() => ({ hold: false }));
vi.mock("../../preparation/latex.ts", async (original) => {
  const actual = await original<typeof import("../../preparation/latex.ts")>();
  return { ...actual, compileLatex: vi.fn((...args: Parameters<typeof actual.compileLatex>) => compile.hold && args[0].includes("/applications/") ? new Promise(() => {}) : actual.compileLatex(...args)) };
});
const home = mkdtempSync(join(tmpdir(), "work-tracker-recovery-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let Service: typeof import("../../preparation/service.ts").PreparationService;
let service: PreparationService;
let jobId = 0;
/** Fake ACP behavior per skill: "done", "hold" (never returns), "login", or "saved-hold" (writes a result, then never returns). */
const modes: Record<string, string> = {};
const calls: string[] = [];
const project = join(home, "source");
const original = "\\documentclass{article}\n% Future certification, not earned\n\\begin{document}\nGeneric project with React and Node.js.\n\\end{document}\n";
function agent(): PreparationAgent {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  return {
    isRunning: false, cancel: vi.fn(), subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    run: async (_provider, skill, params) => {
      calls.push(skill);
      const manifest = JSON.parse(readFileSync(params.manifestPath!, "utf8"));
      const mode = modes[skill] ?? "done";
      if (mode === "login") return { status: "waiting_for_sign_in" };
      if (mode === "hold") return new Promise(() => {});
      if (skill === "portal-filler") {
        writeFileSync(manifest.resultPath, JSON.stringify({ fields: { resume: manifest.pdfPath }, unfilled: [], externalUrl: manifest.url, portal: "generic" }));
        if (mode === "saved-hold") return new Promise(() => {});
      } else {
        writeFileSync(join(manifest.project, manifest.mainFile), original.replace("Generic project", "Tailored project"));
        writeFileSync(manifest.selectionPath, JSON.stringify({ language: "en" }));
        writeFileSync(manifest.reportPath, "# Changes\nEmphasized React.");
      }
      return { status: "done" };
    },
  };
}
/** Simulate closing and reopening the app; the abandoned service never settles its task. */
function restart(): void { service = new Service(agent(), vi.fn()); }
const runOf = (id: string): PreparationRun => service.details({ jobId }).runs.find(run => run.id === id)!;
async function until(id: string, done: (run: PreparationRun) => boolean): Promise<PreparationRun> {
  for (let i = 0; i < 600; i++) { const run = runOf(id); if (done(run)) return run; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Run ${id} is still ${runOf(id).status}/${runOf(id).phase}`);
}
const settled = (id: string) => until(id, run => run.status !== "running");
const applications = () => database.db().query("SELECT id, preparation_status, fill_status, submission_status, resume_path FROM applications WHERE job_id = ?").all(jobId) as Record<string, unknown>[];
async function generated(): Promise<PreparationRun> {
  const run = await settled(service.generate({ jobId, provider: "fake" }).id);
  expect(run.status).toBe("completed");
  return run;
}
beforeAll(async () => {
  database = await import("../../db/index.ts");
  const sources = await import("../../preparation/sources.ts");
  Service = (await import("../../preparation/service.ts")).PreparationService;
  mkdirSync(project);
  writeFileSync(join(project, "resume.tex"), original);
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  restart();
});
beforeEach(() => {
  for (const key of Object.keys(modes)) delete modes[key];
  calls.length = 0;
  compile.hold = false;
  restart();
  jobId = (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', 'Example', 'React developer role', 'https://example.com/apply') RETURNING id").get() as { id: number }).id;
});
afterAll(() => { database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });

test("generation interrupted during tailoring keeps its snapshot and continues in the same run", async () => {
  modes["resume-tailor"] = "hold";
  const run = service.generate({ jobId, provider: "fake", extra: "Emphasize React" });
  await until(run.id, value => value.phase === "tailoring");
  restart();
  const stopped = runOf(run.id);
  expect(stopped).toMatchObject({ status: "interrupted", phase: "tailoring", recovery: { retryFrom: "tailoring", reviewRequired: false, checkpoints: ["sources"] } });
  expect(stopped.recovery.summary).toContain("The app closed during tailoring");
  expect(stopped.artifacts.map(item => item.kind)).toEqual(["base"]);
  delete modes["resume-tailor"];
  service.retry({ runId: run.id });
  const done = await settled(run.id);
  expect(done).toMatchObject({ status: "completed", recovery: { checkpoints: ["sources", "tailored", "compiled"] } });
  expect(done.artifacts.map(item => item.kind)).toEqual(["base", "tailored"]);
  expect(service.details({ jobId }).runs).toHaveLength(1);
  expect(applications()).toEqual([expect.objectContaining({ preparation_status: "ready" })]);
  expect(readFileSync(join(project, "resume.tex"), "utf8")).toBe(original);
}, 60000);

test("generation interrupted during compilation retries only the compilation", async () => {
  compile.hold = true;
  const run = service.generate({ jobId, provider: "fake" });
  await until(run.id, value => value.phase === "compiling");
  restart();
  compile.hold = false;
  expect(runOf(run.id)).toMatchObject({ status: "interrupted", recovery: { retryFrom: "compiling", checkpoints: ["sources", "tailored"] } });
  expect(applications()).toEqual([]);
  calls.length = 0;
  service.retry({ runId: run.id });
  expect((await settled(run.id)).status).toBe("completed");
  expect(calls).toEqual([]);
  expect(applications()).toHaveLength(1);
}, 60000);

test("a fill interrupted with an unknown outcome needs review and never regenerates the resume", async () => {
  const prepared = await generated();
  const [application] = applications();
  modes["portal-filler"] = "hold";
  service.fill({ runId: prepared.id });
  await until(prepared.id, () => calls.includes("portal-filler"));
  restart();
  // The persisted state stays readable after the restart, for the desktop to show on reconnection.
  const stopped = runOf(prepared.id);
  expect(stopped).toMatchObject({ status: "interrupted", phase: "filling", recovery: { retryFrom: "filling", reviewRequired: true } });
  expect(stopped.recovery.summary).toContain("portal may hold a partial fill");
  expect(applications()).toEqual([expect.objectContaining({ fill_status: "failed", resume_path: application!.resume_path })]);
  expect(() => service.retry({ runId: prepared.id })).toThrow("Review it in the browser");
  expect(() => service.fill({ runId: prepared.id })).toThrow("Review it in the browser");
  delete modes["portal-filler"];
  calls.length = 0;
  service.retry({ runId: prepared.id, reviewed: true });
  const done = await settled(prepared.id);
  expect(done).toMatchObject({ status: "completed", recovery: { reviewRequired: false, retryFrom: null } });
  expect(done.artifacts).toEqual(prepared.artifacts);
  expect(calls).toEqual(["portal-filler"]);
  expect(applications()).toEqual([expect.objectContaining({ id: application!.id, fill_status: "filled", submission_status: "not_submitted", resume_path: application!.resume_path })]);
}, 60000);

test("a fill result saved before the app closed is recovered instead of repeated", async () => {
  const prepared = await generated();
  modes["portal-filler"] = "saved-hold";
  service.fill({ runId: prepared.id });
  await until(prepared.id, () => calls.includes("portal-filler"));
  restart();
  expect(runOf(prepared.id)).toMatchObject({ status: "completed", phase: "review", recovery: { retryFrom: null, checkpoints: ["sources", "tailored", "compiled", "filled"] } });
  expect(applications()).toEqual([expect.objectContaining({ fill_status: "filled", submission_status: "not_submitted" })]);
  expect(calls.filter(skill => skill === "portal-filler")).toHaveLength(1);
}, 60000);

test("a pending sign-in during filling is retried without regenerating the resume or duplicating the application", async () => {
  const prepared = await generated();
  const before = applications();
  modes["portal-filler"] = "login";
  service.fill({ runId: prepared.id });
  const waiting = await settled(prepared.id);
  expect(waiting).toMatchObject({ status: "waiting_for_sign_in", recovery: { retryFrom: "filling", reviewRequired: false } });
  delete modes["portal-filler"];
  calls.length = 0;
  service.retry({ runId: prepared.id });
  expect((await settled(prepared.id)).status).toBe("completed");
  expect(calls).toEqual(["portal-filler"]);
  expect(applications()).toEqual([{ ...before[0], fill_status: "filled" }]);
  expect(service.details({ jobId }).runs).toHaveLength(1);
}, 60000);

test("a sign-in pending when the app closes is reported as lost, not as a restorable session", async () => {
  modes["resume-tailor"] = "login";
  const run = service.generate({ jobId, provider: "fake" });
  expect((await settled(run.id)).status).toBe("waiting_for_sign_in");
  restart();
  const stopped = runOf(run.id);
  expect(stopped).toMatchObject({ status: "interrupted", recovery: { retryFrom: "tailoring" } });
  expect(stopped.error).toContain("cannot be restored");
  delete modes["resume-tailor"];
  service.retry({ runId: run.id });
  expect((await settled(run.id)).status).toBe("completed");
  expect(applications()).toHaveLength(1);
  expect(existsSync(join(home, "artifacts", "applications", String(jobId), run.id, "resume.pdf"))).toBe(true);
}, 60000);
