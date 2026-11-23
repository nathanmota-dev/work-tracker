/**
 * Follow-up and thank-you drafts against real SQLite, the HTTP handlers and the
 * compiled CLI: a quiet application is due, a saved draft can be marked as
 * sent (restarting the quiet clock) or discarded (changing nothing), the cap of
 * two follow-ups holds, and an interview move offers a thank-you note.
 */
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TrackedApplication } from "../../applications/types.ts";
import type { FollowupCandidates, FollowupDraft } from "../../followups/types.ts";

const run = promisify(execFile);
const home = mkdtempSync(join(tmpdir(), "work-tracker-followups-"));
const previousEnv = { ...process.env };
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_CLI = resolve("out/cli/work-tracker.cjs");
let db: typeof import("../../db/index.ts").db;
let closeDb: typeof import("../../db/index.ts").closeDb;
let handle: (req: Request) => Promise<Response>;
const broadcast = vi.fn();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [process.env.WORK_TRACKER_CLI!, ...args], { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}
const api = (path: string, body?: unknown) =>
  handle(new Request(`http://localhost/api/${path}${path.includes("?") ? "&" : "?"}token=secret`, body === undefined ? {} : {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }));
const json = async <T>(path: string, body?: unknown) => (await (await api(path, body)).json()) as T;
async function sentDaysAgo(company_name: string, days: number): Promise<number> {
  const { id } = await json<TrackedApplication>("application-board/create", {
    company_name, external_url: `https://jobs.example.test/${company_name}`, applied_at: ago(days),
  });
  db().query("UPDATE application_events SET occurred_at = ? WHERE application_id = ?").run(ago(days), id);
  db().query("UPDATE application_transitions SET occurred_at = ? WHERE application_id = ?").run(ago(days), id);
  return id;
}
function bodyFile(name: string, text: string): string {
  const directory = join(home, "artifacts", "followups");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), text);
  return join(directory, name);
}
const save = (id: number, ...extra: string[]) =>
  cli("followup", "save", "--application-id", String(id), "--kind", "follow_up", "--channel", "linkedin", "--file", bodyFile(`${id}.md`, words(80)), ...extra);
const draftId = (stdout: string) => Number(/#(\d+)/.exec(stdout)![1]);
const due = () => json<FollowupCandidates>("followups/candidates");

beforeAll(async () => {
  ({ db, closeDb } = await import("../../db/index.ts"));
  const { createRequestHandler } = await import("../../server/index.ts");
  handle = createRequestHandler({ token: "secret", acp: { run: async () => {}, cancel: () => {} }, broadcast });
  db();
});
beforeEach(() => {
  db().exec("DELETE FROM followup_drafts; DELETE FROM application_events; DELETE FROM application_transitions; DELETE FROM applications;");
  broadcast.mockClear();
});
afterAll(() => {
  closeDb();
  rmSync(home, { recursive: true, force: true });
  process.env = previousEnv;
});

test("save, list, mark as sent and the restarted clock across the CLI and the API", async () => {
  const quiet = await sentDaysAgo("Quiet", 12);
  await sentDaysAgo("Recent", 3);
  expect((await due()).follow_ups).toEqual([expect.objectContaining({ id: quiet, days_quiet: 12, sent_count: 0, has_draft: false })]);
  const fromCli = await cli("followup", "candidates");
  expect(JSON.parse(fromCli.stdout)).toMatchObject({ days: 10, follow_ups: [{ id: quiet }] });
  const saved = await save(quiet);
  expect(saved).toMatchObject({ code: 0, stdout: expect.stringContaining("saved") });
  const id = draftId(saved.stdout);
  expect(JSON.parse((await cli("followup", "list", "--application-id", String(quiet))).stdout)).toEqual([
    expect.objectContaining({ id, kind: "follow_up", channel: "linkedin", subject: null, status: "draft", body_md: words(80), sent_at: null }),
  ]);
  // Drafting changes neither the count nor the clock.
  expect((await due()).follow_ups).toEqual([expect.objectContaining({ id: quiet, days_quiet: 12, has_draft: true })]);
  broadcast.mockClear();
  const marked = await json<FollowupDraft>("followups/sent", { id });
  expect(marked).toMatchObject({ id, status: "sent", sent_at: expect.any(String) });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "followup_drafts" });
  expect((await due()).follow_ups).toEqual([]);
  expect((await json<{ items: unknown[] }>("application-board/quiet?days=7")).items).toEqual([]);
  // Marking again keeps the first date and broadcasts nothing.
  broadcast.mockClear();
  expect(await json<FollowupDraft>("followups/sent", { id })).toEqual(marked);
  expect(broadcast).not.toHaveBeenCalled();
  expect(await json<FollowupDraft[]>(`followups?application_id=${quiet}`)).toEqual([marked]);
});

test("discarding changes nothing, and the third follow-up is refused with a clear message", async () => {
  const app = await sentDaysAgo("Capped", 40);
  const discarded = draftId((await save(app)).stdout);
  expect(await json<FollowupDraft>("followups/discard", { id: discarded })).toMatchObject({ status: "discarded", sent_at: null });
  expect((await due()).follow_ups).toEqual([expect.objectContaining({ id: app, days_quiet: 40, sent_count: 0, has_draft: false })]);
  for (const days of [25, 11]) {
    const id = draftId((await save(app)).stdout);
    await api("followups/sent", { id });
    db().query("UPDATE followup_drafts SET sent_at = ? WHERE id = ?").run(ago(days), id);
  }
  expect((await due()).follow_ups).toEqual([]);
  const third = await save(app);
  expect(third).toMatchObject({ code: 1, stderr: expect.stringContaining("2 follow-ups were already sent for application") });
  const sentDraft = (JSON.parse((await cli("followup", "list", "--application-id", String(app))).stdout) as FollowupDraft[]).find((draft) => draft.status === "sent")!;
  const sentAgain = await api("followups/discard", { id: sentDraft.id });
  expect(sentAgain.status).toBe(409);
  expect(await cli("followup", "save", "--application-id", String(app), "--kind", "follow_up", "--channel", "email", "--file", bodyFile("short.md", words(20)), "--subject", "Hi"))
    .toMatchObject({ code: 1, stderr: expect.stringContaining("20 words") });
});

test("an interview move offers a thank-you note that a draft answers without moving the stage", async () => {
  const app = await sentDaysAgo("Interview", 2);
  const technical = db().query("SELECT id FROM application_stages WHERE key = 'technical'").get() as { id: number };
  await api("application-board/move", { id: app, stage_id: technical.id });
  const [offer] = (await due()).thank_yous;
  expect(offer).toMatchObject({ id: app, stage_name: "Technical interview", stage_event_id: expect.any(Number) });
  const saved = await cli("followup", "save", "--application-id", String(app), "--kind", "thank_you", "--channel", "email",
    "--subject", "Thank you", "--stage-event", String(offer!.stage_event_id), "--file", bodyFile("thanks.md", words(70)));
  expect(saved.code).toBe(0);
  expect((await due()).thank_yous).toEqual([]);
  expect(db().query("SELECT current_stage_id FROM applications WHERE id = ?").get(app)).toEqual({ current_stage_id: technical.id });
  expect((await api("followups?application_id=abc")).status).toBe(400);
  expect((await api("followups/candidates?days=2")).status).toBe(400);
});
