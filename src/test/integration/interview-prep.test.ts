import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../db/sqlite.ts";
import { migrateDatabase } from "../../db/migrations.ts";
import { db } from "../../db/index.ts";
import { applicationContext } from "../../interview-prep/context.ts";
import { handleInterviewPreps } from "../../interview-prep/http.ts";
import { InterviewPrepError, listInterviewPreps, saveInterviewPrep } from "../../interview-prep/store.ts";

vi.mock("../../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-20T12:00:00.000Z" }));

const homes: string[] = [];
let d: Database;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "work-tracker-prep-")); homes.push(home);
  d = new Database(join(home, "prep.db"));
  migrateDatabase(d, { backupDir: join(home, "backups") });
  d.exec("PRAGMA foreign_keys = ON;");
  vi.mocked(db).mockReturnValue(d);
  d.exec(`INSERT INTO jobs (id, title, company_name, location, description, requirements_json) VALUES (1, 'Backend Engineer', 'Acme', 'Remote', 'Build APIs', '["Node","SQL"]')`);
  d.exec(`INSERT INTO applications (id, job_id, resume_path, notes) VALUES (7, 1, '/tmp/cv.pdf', 'referral')`);
});
afterEach(() => { d.close(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

test("stores a pack per stage and keeps earlier packs as history, newest first", () => {
  const first = saveInterviewPrep({ applicationId: 7, stage: " Recruiter screen ", body: " # Pack one ", format: "video" });
  const second = saveInterviewPrep({ applicationId: 7, stage: "Recruiter screen", body: "# Pack two", interviewers: "Ana, VP" });
  expect(second).toBeGreaterThan(first);
  const packs = listInterviewPreps(7);
  expect(packs.map((pack) => pack.body_md)).toEqual(["# Pack two", "# Pack one"]);
  expect(packs[1]).toMatchObject({ stage: "Recruiter screen", format: "video", scheduled_at: null, created_at: "2026-11-20T12:00:00.000Z" });
  expect(listInterviewPreps(8)).toEqual([]);
  expect(listInterviewPreps()).toHaveLength(2);
});

test.each([
  [{ applicationId: 0, stage: "x", body: "x" }, "positive integer"],
  [{ applicationId: Number.NaN, stage: "x", body: "x" }, "positive integer"],
  [{ applicationId: 7, stage: "  ", body: "x" }, "stage is required"],
  [{ applicationId: 7, stage: "x", body: "  " }, "empty"],
  [{ applicationId: 99, stage: "x", body: "x" }, "#99 not found"],
])("rejects invalid input %j without writing", (input, message) => {
  expect(() => saveInterviewPrep(input)).toThrow(InterviewPrepError);
  expect(() => saveInterviewPrep(input)).toThrow(message);
  expect(listInterviewPreps()).toEqual([]);
});

test("application context joins the job and parses requirements", () => {
  expect(applicationContext(7)).toMatchObject({ id: 7, company: "Acme", role: "Backend Engineer", location: "Remote", description: "Build APIs", requirements: ["Node", "SQL"], resume_path: "/tmp/cv.pdf", notes: "referral" });
  expect(applicationContext(404)).toBeNull();
  d.exec(`UPDATE jobs SET requirements_json = 'not json' WHERE id = 1`);
  expect(applicationContext(7)?.requirements).toBe("not json");
  d.exec(`UPDATE jobs SET requirements_json = NULL WHERE id = 1`);
  expect(applicationContext(7)?.requirements).toBeNull();
});

test("HTTP lists packs, filters by application and rejects bad ids and methods", async () => {
  saveInterviewPrep({ applicationId: 7, stage: "Final", body: "pack" });
  const get = (suffix = "") => handleInterviewPreps(`/api/interview-preps${suffix}`, new Request(`http://localhost/api/interview-preps${suffix}`));
  expect(await get().json()).toHaveLength(1);
  expect(await get("/7").json()).toHaveLength(1);
  expect(await get("/8").json()).toEqual([]);
  expect(get("/abc").status).toBe(400);
  expect(get("/0").status).toBe(400);
  expect(get("/7/extra").status).toBe(400);
  expect(handleInterviewPreps("/api/interview-preps", new Request("http://localhost/api/interview-preps", { method: "POST" })).status).toBe(404);
});
