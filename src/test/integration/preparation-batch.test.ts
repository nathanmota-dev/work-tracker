import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PreparationAgent, PreparationService } from "../../preparation/service.ts";
import type { PreparationQueue } from "../../preparation/batch-queue.ts";
import type { PreparationBatch, PreparationBatchItem } from "../../preparation/types.ts";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}), chromeLoginOpening: () => false, openChromeLogin: vi.fn() }));
vi.mock("../../mcp/search.ts", () => ({ jobDetails: vi.fn(async () => ({ description: "React developer" })) }));
// Counts LaTeX runs so preview reuse is observable.
const compiled = vi.hoisted(() => ({ base: 0, tailored: 0 }));
vi.mock("../../preparation/latex.ts", async (original) => {
  const actual = await original<typeof import("../../preparation/latex.ts")>();
  return { ...actual, compileLatex: vi.fn((...args: Parameters<typeof actual.compileLatex>) => { compiled[args[0].includes("/applications/") ? "tailored" : "base"]++; return actual.compileLatex(...args); }) };
});
const home = mkdtempSync(join(tmpdir(), "work-tracker-batch-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let Service: typeof import("../../preparation/service.ts").PreparationService;
let Queue: typeof import("../../preparation/batch-queue.ts").PreparationQueue;
let routeApi: typeof import("../../server/routes.ts").routeApi;
let service: PreparationService;
let queue: PreparationQueue;
let agent: ReturnType<typeof fakeAgent>;
/** Fake ACP behavior per `skill:jobId`: "fail", "hold", "login" or "permission"; default completes. */
const modes: Record<string, string> = {};
const calls: string[] = [];
const project = join(home, "source");
const original = "\\documentclass{article}\n\\begin{document}\nGeneric project with React and Node.js.\n\\end{document}\n";

function fakeAgent() {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const waits = new Map<string, (answer: string) => void>();
  let running = 0;
  let concurrent = 0;
  const emit = (event: Record<string, unknown>) => { for (const listener of listeners) listener(event); queue?.observe(event); };
  const wait = (key: string) => new Promise<string>(resolve => waits.set(key, resolve));
  const fake = {
    get isRunning() { return running > 0; },
    concurrent: () => concurrent,
    /** Release a held run, a Launch run or answer a permission request. */
    answer: (key: string, value = "done") => { waits.get(key)!(value); waits.delete(key); },
    waiting: (key: string) => waits.has(key),
    cancel: vi.fn(() => { for (const key of [...waits.keys()]) fake.answer(key, "cancelled"); }),
    subscribe: (listener: (event: Record<string, unknown>) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run: async (_provider: string, skill: string, params: Record<string, string>) => {
      running++;
      concurrent = Math.max(concurrent, running);
      try {
        if (!params.manifestPath) { calls.push(`launch:${skill}`); return { status: await wait("launch") === "cancelled" ? "cancelled" as const : "done" as const }; }
        const manifest = JSON.parse(readFileSync(params.manifestPath, "utf8"));
        const key = `${skill}:${manifest.job.id}`;
        calls.push(key);
        const mode = modes[key];
        if (mode === "fail") return { status: "error" as const, message: "Synthetic agent failure" };
        if (mode === "login") return { status: "waiting_for_sign_in" as const };
        if (mode === "hold" && await wait(key) === "cancelled") return { status: "cancelled" as const };
        if (mode === "permission") {
          emit({ type: "acp-status", status: "waiting_for_permission", runId: params.runId });
          const decision = await wait(key);
          emit({ type: "acp-status", status: "running", runId: params.runId });
          if (decision !== "done") return { status: "cancelled" as const };
        }
        if (skill === "portal-filler") writeFileSync(manifest.resultPath, JSON.stringify({ versionId: manifest.versionId, pdfHash: manifest.pdfHash, pdfPath: manifest.pdfPath, fields: { resume: manifest.pdfPath, email: "candidate@example.com" }, unfilled: [], externalUrl: manifest.url, portal: "generic" }));
        else {
          writeFileSync(join(manifest.project, manifest.mainFile), original.replace("Generic project", `Tailored for ${manifest.job.company_name}`));
          writeFileSync(manifest.selectionPath, JSON.stringify({ language: "en" }));
          writeFileSync(manifest.reportPath, "# Changes\nEmphasized React.");
        }
        return { status: "done" as const };
      } finally { running--; }
    },
  };
  return fake;
}
/** Start a backend on the same workspace; the previous one is abandoned as if the app closed. */
function start(): void {
  queue?.close();
  agent = fakeAgent();
  service = new Service(agent as unknown as PreparationAgent, event => queue?.observe(event));
  queue = new Queue(service, () => agent.isRunning, () => {}, 0);
}
const job = (company: string) => (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', ?, 'React developer role', ?) RETURNING id").get(company, `https://example.com/${company}`) as { id: number }).id;
const batchOf = (id: string): PreparationBatch => queue.state().batches.find(batch => batch.id === id)!;
const itemsOf = (id: string): PreparationBatchItem[] => batchOf(id).items;
const states = (id: string) => itemsOf(id).map(item => `${item.phase}/${item.status}`);
async function until<T>(read: () => T, done: (value: T) => boolean, timeout = 60_000): Promise<T> {
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 25))) { const value = read(); if (done(value)) return value; }
  throw new Error(`Timed out; last state: ${JSON.stringify(read())}`);
}
/** Nothing runs or is about to start, except fills held back by a form in review. */
const settled = async (id: string) => (await until(() => batchOf(id), batch => !service.isBusy && !batch.items.some(item => ["running", "waiting_for_decision"].includes(item.status)
  || (batch.status === "active" && item.status === "pending" && item.phase !== "waiting_for_fill")))).items;
const create = (jobs: number[]) => queue.create({ provider: "fake", items: jobs.map(jobId => ({ jobId })) });
const count = (sql: string, ...args: (string | number)[]) => (database.db().query(sql).get(...args) as { n: number }).n;
function approve(item: PreparationBatchItem): void {
  const version = service.details({ jobId: item.jobId }).documents!.find(value => value.runId === item.runId)!;
  service.approve({ runId: item.runId, versionId: version.id });
  queue.observe({ type: "changed", table: "application_runs" });
}
beforeAll(async () => {
  database = await import("../../db/index.ts");
  const sources = await import("../../preparation/sources.ts");
  Service = (await import("../../preparation/service.ts")).PreparationService;
  Queue = (await import("../../preparation/batch-queue.ts")).PreparationQueue;
  routeApi = (await import("../../server/routes.ts")).routeApi;
  mkdirSync(project);
  writeFileSync(join(project, "resume.tex"), original);
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile: "", engine: "pdflatex" });
});
beforeEach(() => {
  // Each scenario starts without a form reserving the portal.
  database?.db().exec("UPDATE preparation_batch_items SET status = 'cancelled', holds_portal = 0 WHERE status NOT IN ('completed', 'cancelled')");
  for (const key of Object.keys(modes)) delete modes[key];
  calls.length = 0;
  writeFileSync(join(project, "resume.tex"), original);
  start();
});
afterAll(() => { queue?.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });

test("a batch with successes and a failure keeps every result and runs one agent at a time", async () => {
  const [a, b, c] = [job("Alpha"), job("Beta"), job("Gamma")];
  modes[`resume-tailor:${b}`] = "fail";
  const batch = create([a, b, c]);
  const items = await settled(batch.id);
  expect(agent.concurrent()).toBe(1);
  expect(calls).toEqual([`resume-tailor:${a}`, `resume-tailor:${b}`, `resume-tailor:${c}`]);
  expect(items.map(item => [item.position, item.phase, item.status, item.attempts])).toEqual([[1, "ready_for_review", "waiting_for_user", 1], [2, "tailoring", "failed", 1], [3, "ready_for_review", "waiting_for_user", 1]]);
  expect(items[1]).toMatchObject({ error: "Synthetic agent failure", retryable: true });
  expect(count("SELECT COUNT(*) AS n FROM document_versions v JOIN application_runs r ON r.id = v.run_id WHERE r.job_id IN (?, ?)", a, c)).toBe(2);
  delete modes[`resume-tailor:${b}`];
  queue.retry({ batchId: batch.id });
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "tailoring/pending", "ready_for_review/waiting_for_user"]);
  const retried = await settled(batch.id);
  expect(retried.map(item => [item.status, item.attempts])).toEqual([["waiting_for_user", 1], ["waiting_for_user", 2], ["waiting_for_user", 1]]);
  expect(retried[1]!.runId).toBe(items[1]!.runId);
  expect(calls.filter(call => call === `resume-tailor:${a}`)).toHaveLength(1);
  expect(count("SELECT COUNT(*) AS n FROM applications WHERE job_id IN (?, ?, ?)", a, b, c)).toBe(3);
}, 120_000);

test("restarting with an item in progress marks it interrupted and resumes pending items without repeating finished ones", async () => {
  const [a, b, c] = [job("Restart A"), job("Restart B"), job("Restart C")];
  modes[`resume-tailor:${b}`] = "hold";
  const batch = create([a, b, c]);
  await until(() => agent.waiting(`resume-tailor:${b}`), Boolean);
  start();
  expect(batchOf(batch.id)).toMatchObject({ status: "paused", pauseReason: "restart" });
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "tailoring/interrupted", "queued/pending"]);
  expect(itemsOf(batch.id)[1]!.error).toContain("The app closed");
  delete modes[`resume-tailor:${b}`];
  queue.resume({ batchId: batch.id });
  await settled(batch.id);
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "tailoring/interrupted", "ready_for_review/waiting_for_user"]);
  queue.retry({ batchId: batch.id, itemId: itemsOf(batch.id)[1]!.id });
  const items = await settled(batch.id);
  expect(items.map(item => item.status)).toEqual(["waiting_for_user", "waiting_for_user", "waiting_for_user"]);
  expect(calls).toEqual([`resume-tailor:${a}`, `resume-tailor:${b}`, `resume-tailor:${c}`, `resume-tailor:${b}`]);
  expect(count("SELECT COUNT(*) AS n FROM application_runs WHERE job_id = ?", b)).toBe(1);
  expect(count("SELECT COUNT(*) AS n FROM applications WHERE job_id IN (?, ?, ?)", a, b, c)).toBe(3);
}, 120_000);

test("pause, cancel and retry keep phases and positions; a concurrent Launch never takes the busy session", async () => {
  const [a, b, c] = [job("Pause A"), job("Pause B"), job("Pause C")];
  modes[`resume-tailor:${a}`] = "hold";
  modes[`resume-tailor:${c}`] = "fail";
  const batch = create([a, b, c]);
  await until(() => agent.waiting(`resume-tailor:${a}`), Boolean);
  const launch = () => routeApi("/api/acp/run", new Request("http://local/api/acp/run", { method: "POST", body: JSON.stringify({ skill: "job-scout" }) }), { acp: agent, broadcast: () => {}, preparation: service });
  expect((await launch()).status).toBe(409);
  queue.pause({ batchId: batch.id });
  agent.answer(`resume-tailor:${a}`);
  await settled(batch.id);
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "queued/pending", "queued/pending"]);
  await queue.cancel({ batchId: batch.id, itemId: itemsOf(batch.id)[1]!.id });
  expect(itemsOf(batch.id).map(item => [item.position, item.status])).toEqual([[1, "waiting_for_user"], [2, "cancelled"], [3, "pending"]]);
  expect((await launch()).status).toBe(200);
  await until(() => agent.isRunning, Boolean);
  queue.resume({ batchId: batch.id });
  queue.pump();
  expect(states(batch.id)[2]).toBe("queued/pending");
  agent.answer("launch");
  queue.observe({ type: "acp-status", status: "done" });
  await settled(batch.id);
  expect(itemsOf(batch.id)[2]).toMatchObject({ phase: "tailoring", status: "failed" });
  expect(() => queue.retry({ batchId: batch.id, itemId: itemsOf(batch.id)[1]!.id })).toThrow("Only failed");
  delete modes[`resume-tailor:${c}`];
  queue.retry({ batchId: batch.id });
  await settled(batch.id);
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "queued/cancelled", "ready_for_review/waiting_for_user"]);
  expect(calls).toEqual([`resume-tailor:${a}`, "launch:job-scout", `resume-tailor:${c}`, `resume-tailor:${c}`]);
  expect(agent.concurrent()).toBe(1);
}, 120_000);

test("an item waiting for a permission decision does not block the rest; the decision resumes it", async () => {
  const [a, b, c] = [job("Decide A"), job("Decide B"), job("Decide C")];
  modes[`resume-tailor:${a}`] = "permission";
  modes[`resume-tailor:${b}`] = "permission";
  const batch = create([a, b, c]);
  await until(() => states(batch.id)[0], state => state === "tailoring/waiting_for_decision");
  expect(states(batch.id).slice(1)).toEqual(["queued/pending", "queued/pending"]);
  agent.answer(`resume-tailor:${a}`);
  await until(() => states(batch.id)[1], state => state === "tailoring/waiting_for_decision");
  expect(states(batch.id)[0]).toBe("ready_for_review/waiting_for_user");
  // Cancelling the waiting item releases the agent for the next one.
  await queue.cancel({ batchId: batch.id, itemId: itemsOf(batch.id)[1]!.id });
  await settled(batch.id);
  expect(states(batch.id)).toEqual(["ready_for_review/waiting_for_user", "tailoring/cancelled", "ready_for_review/waiting_for_user"]);
  expect(calls).toEqual([`resume-tailor:${a}`, `resume-tailor:${b}`, `resume-tailor:${c}`]);
}, 120_000);

test("a second fill waits for the form in review; generating meanwhile leaves it untouched and nothing is submitted automatically", async () => {
  const { openChromePortal } = await import("../../mcp/chrome.ts");
  const { buildSkillPrompt } = await import("../../acp/session.ts");
  const [a, b, d] = [job("Portal A"), job("Portal B"), job("Portal D")];
  const batch = create([a, b]);
  const generated = await settled(batch.id);
  approve(generated[0]!);
  const inReview = await until(() => itemsOf(batch.id)[0]!, item => item.phase === "in_review");
  expect(inReview).toMatchObject({ status: "waiting_for_user", holdsPortal: true });
  const form = () => database.db().query("SELECT fields_filled_json, fill_status, submission_status FROM applications WHERE id = ?").get(inReview.applicationId);
  const filledForm = form();
  approve(generated[1]!);
  queue.add({ batchId: batch.id, items: [{ jobId: d }] });
  await settled(batch.id);
  expect(states(batch.id)).toEqual(["in_review/waiting_for_user", "waiting_for_fill/pending", "ready_for_review/waiting_for_user"]);
  expect(form()).toEqual(filledForm);
  expect(vi.mocked(openChromePortal)).toHaveBeenCalledTimes(1);
  expect(queue.state().portal).toMatchObject({ itemId: inReview.id, label: "Portal A · Engineer" });
  expect(() => service.fill({ runId: generated[1]!.runId })).toThrow("The Portal A · Engineer form is waiting for your review");
  expect(calls.filter(call => call.startsWith("portal-filler"))).toEqual([`portal-filler:${a}`]);
  service.submitted({ runId: inReview.runId });
  await until(() => itemsOf(batch.id)[1]!, item => item.phase === "in_review");
  expect(states(batch.id)).toEqual(["submitted/completed", "in_review/waiting_for_user", "ready_for_review/waiting_for_user"]);
  expect(database.db().query("SELECT submission_status FROM applications WHERE job_id IN (?, ?, ?) ORDER BY job_id").all(a, b, d)).toEqual([{ submission_status: "submitted" }, { submission_status: "not_submitted" }, { submission_status: "not_submitted" }]);
  expect(buildSkillPrompt("portal-filler", { manifestPath: "/fill.json" })).toContain("without clicking Submit");
}, 120_000);

test("a fill interrupted with an unknown outcome is never repeated without review", async () => {
  const [a, b] = [job("Unknown A"), job("Unknown B")];
  const batch = create([a, b]);
  const generated = await settled(batch.id);
  modes[`portal-filler:${a}`] = "hold";
  approve(generated[0]!);
  approve(generated[1]!);
  await until(() => agent.waiting(`portal-filler:${a}`), Boolean);
  start();
  queue.resume({ batchId: batch.id });
  queue.pump();
  expect(service.isBusy).toBe(false);
  expect(itemsOf(batch.id).map(item => [item.phase, item.status, item.holdsPortal, item.reviewRequired])).toEqual([["filling", "interrupted", true, true], ["waiting_for_fill", "pending", false, false]]);
  expect(() => queue.retry({ batchId: batch.id })).toThrow("Review it in the browser");
  delete modes[`portal-filler:${a}`];
  queue.retry({ batchId: batch.id, itemId: itemsOf(batch.id)[0]!.id, reviewed: true });
  await until(() => states(batch.id)[0], state => state === "in_review/waiting_for_user");
  expect(calls.filter(call => call.startsWith("portal-filler"))).toEqual([`portal-filler:${a}`, `portal-filler:${a}`]);
  expect(states(batch.id)[1]).toBe("waiting_for_fill/pending");
}, 120_000);

test("the base preview is reused only while the sources keep the same version", async () => {
  writeFileSync(join(project, "resume.tex"), original.replace("Generic", "Cache baseline"));
  const before = { ...compiled };
  const first = create([job("Cache A"), job("Cache B")]);
  // Editing the sources after creating a batch does not change the version its items use.
  writeFileSync(join(project, "resume.tex"), original.replace("Generic", "Edited"));
  await settled(first.id);
  expect(compiled.base - before.base).toBe(1);
  expect(compiled.tailored - before.tailored).toBe(2);
  const versions = () => database.db().query("SELECT DISTINCT source_version AS version FROM document_versions v JOIN preparation_batch_items i ON i.run_id = v.run_id WHERE i.batch_id = ?").all(first.id);
  expect(versions()).toEqual([{ version: first.sourceVersion }]);
  const second = create([job("Cache C")]);
  expect(second.sourceVersion).not.toBe(first.sourceVersion);
  await settled(second.id);
  expect(compiled.base - before.base).toBe(2);
  const third = create([job("Cache D")]);
  await settled(third.id);
  expect(third.sourceVersion).toBe(second.sourceVersion);
  expect(compiled.base - before.base).toBe(2);
}, 120_000);
