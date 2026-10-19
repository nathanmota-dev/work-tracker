import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
const home = mkdtempSync(join(tmpdir(), "work-tracker-fill-review-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let answers: typeof import("../../answers/store.ts");
let service: import("../../preparation/service.ts").PreparationService;
let jobId: number;
let broken = false;
const skills: string[] = [];
const LABELS = ["Email", "Phone", "Gender", "Favorite color"];

/** Synthetic portal agent: matches the form labels against the saved answers, as the skill does. */
async function portal(manifestPath: string): Promise<void> {
  const { matchLabels } = await import("../../match/matcher.ts");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const saved = Object.fromEntries(answers.listAnswerVariants().filter(row => row.language === "default" && row.value).map(row => [row.key, row.value!]));
  const plan = matchLabels(LABELS, { answers: saved });
  if (broken) { writeFileSync(manifest.resultPath, '{"fields":[]}'); return; }
  writeFileSync(manifest.resultPath, JSON.stringify({
    versionId: manifest.versionId, pdfHash: manifest.pdfHash, pdfPath: manifest.pdfPath, portal: "greenhouse", externalUrl: "https://boards.greenhouse.io/example/jobs/1",
    fields: { resume: manifest.pdfPath, ...Object.fromEntries(plan.matched.map(entry => [entry.key, entry.value])) },
    unfilled: plan.unfilled.map(({ label, key, skip }) => ({ label, key, reason: skip })),
  }));
}
async function complete(id: string) {
  for (let i = 0; i < 300; i++) { const run = service.details({ jobId }).runs.find(r => r.id === id)!; if (run.status !== "running") return run; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error("Execution did not finish");
}
beforeAll(async () => {
  database = await import("../../db/index.ts");
  answers = await import("../../answers/store.ts");
  const sources = await import("../../preparation/sources.ts");
  const { PreparationService } = await import("../../preparation/service.ts");
  const project = join(home, "source");
  mkdirSync(project);
  writeFileSync(join(project, "resume.tex"), "\\documentclass{article}\n\\begin{document}\nGeneric project.\n\\end{document}\n");
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
  jobId = (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', 'Example', 'Generic role', 'https://example.com/apply') RETURNING id").get() as { id: number }).id;
  answers.saveAnswer({ key: "email", value: "candidate@example.com" });
  service = new PreparationService({
    isRunning: false, cancel: vi.fn(),
    run: async (_provider, skill, params) => {
      skills.push(skill);
      if (skill === "portal-filler") { await portal(params.manifestPath!); return { status: "done" }; }
      const manifest = JSON.parse(readFileSync(params.manifestPath!, "utf8"));
      writeFileSync(manifest.selectionPath, "{}");
      writeFileSync(manifest.reportPath, "# Changes");
      return { status: "done" };
    },
  }, vi.fn());
});
afterAll(async () => { await service?.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });

test("correcting an answer and filling again keeps the approved PDF and updates only the fill result", async () => {
  const store = await import("../../preparation/store.ts");
  const run = await complete(service.generate({ jobId, provider: "fixture" }).id);
  const version = service.details({ jobId }).documents!.find(item => item.runId === run.id)!;
  const approved = service.approve({ runId: run.id, versionId: version.id });
  const other = database.db().query("INSERT INTO applications (job_id, status, attempt, fields_filled_json, unfilled_json) VALUES (?, 'filled', 2, '{\"email\":\"other@example.com\"}', '[]') RETURNING id").get(jobId) as { id: number };
  expect(service.details({ jobId, applicationId: run.application_id }).fill).toBeNull();

  await complete(service.fill({ runId: run.id, versionId: version.id }).id);
  const first = service.details({ jobId, applicationId: run.application_id }).fill!;
  expect(first).toMatchObject({ portal: "greenhouse", portalLabel: "Greenhouse", reviewUrl: "https://boards.greenhouse.io/example/jobs/1", document: { versionId: version.id, pdfHash: version.pdfHash }, fillStatus: "filled", submitted: false, filled: 2, pending: 3 });
  expect(first.items.find(item => item.label === "Phone")).toMatchObject({ result: "pending", reason: "no-stored-answer", correctionKey: "phone" });
  expect(first.items.find(item => item.label === "Gender")).toMatchObject({ reason: "eeo-human-only", correctionKey: null });
  const artifacts = database.db().query("SELECT COUNT(*) AS count FROM pdf_artifacts").get();
  const pdf = readFileSync(store.artifactFile(version.id).path);

  answers.saveAnswer({ key: "phone", value: "+1 555 0100 200" });
  await complete(service.fill({ runId: run.id, versionId: version.id }).id);
  const second = service.details({ jobId, applicationId: run.application_id });
  expect(second.fill).toMatchObject({ document: { versionId: version.id, pdfHash: version.pdfHash }, filled: 3, pending: 2, submitted: false });
  expect(second.fill!.items.find(item => item.label === "Phone")).toMatchObject({ result: "filled", answer: "+1 555 0100 200", correctionKey: "phone" });
  expect(second.documents!.find(item => item.id === version.id)).toMatchObject({ approvedAt: approved.approvedAt, pdfHash: version.pdfHash, submittedAt: null });
  expect(second.journey).toMatchObject({ fill_status: "filled", submission_status: "not_submitted" });
  expect(second.runs).toHaveLength(1);
  expect(skills.filter(skill => skill === "resume-tailor")).toHaveLength(1);
  expect(database.db().query("SELECT COUNT(*) AS count FROM pdf_artifacts").get()).toEqual(artifacts);
  expect(readFileSync(store.artifactFile(version.id).path)).toEqual(pdf);
  expect(database.db().query("SELECT fields_filled_json, unfilled_json FROM applications WHERE id = ?").get(other.id)).toEqual({ fields_filled_json: '{"email":"other@example.com"}', unfilled_json: "[]" });

  // A failed retry keeps the previous evidence and never reports a new fill or a submission.
  broken = true;
  expect((await complete(service.fill({ runId: run.id }).id)).status).toBe("failed");
  const failed = service.details({ jobId, applicationId: run.application_id });
  expect(failed.fill).toEqual(second.fill);
  expect(failed.journey).toMatchObject({ fill_status: "filled", submission_status: "not_submitted" });
  broken = false;
}, 60000);
