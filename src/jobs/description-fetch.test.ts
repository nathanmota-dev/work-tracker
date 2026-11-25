import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Database } from "../db/sqlite.ts";
import { insertJob, memoryDatabase } from "../test/memory-db.ts";
import { DescriptionFetcher, MAX_ATTEMPTS, missingDescriptions } from "./description-fetch.ts";

let d: Database;
const posting = (body: string) => ({ sections: { job_posting: `Apply\nAbout the job\n${body}\nAbout the company\nCorp` } });
const description = (id: number) => (d.query("SELECT description FROM jobs WHERE id = ?").get(id) as { description: string | null }).description;

function fetcher(fetchDetails: (id: string) => Promise<unknown>, busy = () => false) {
  const broadcast = vi.fn();
  const instance = new DescriptionFetcher({ db: () => d, fetchDetails, busy, broadcast, delayMs: 10, busyMs: 100, retryMs: 1000 });
  return { instance, broadcast };
}

beforeEach(async () => { d = await memoryDatabase(); });
afterEach(() => { vi.useRealTimers(); });

test("selects only active, recent LinkedIn jobs without a description", () => {
  const due = insertJob(d, { linkedin_job_id: "1" });
  insertJob(d, { linkedin_job_id: "2", link: "https://jobs.example.test/2", description: "Saved by the agent." });
  insertJob(d, { linkedin_job_id: "3", link: "https://jobs.example.test/3", archived_at: "2026-11-01" });
  insertJob(d, { linkedin_job_id: "4", link: "https://jobs.example.test/4", scouted_at: "2020-01-01 00:00:00" });
  insertJob(d, { link: "https://jobs.example.test/5" });
  const blank = insertJob(d, { linkedin_job_id: "6", link: "https://jobs.example.test/6", description: "  " });
  expect(missingDescriptions(d)).toEqual([{ id: due, linkedin_job_id: "1" }, { id: blank, linkedin_job_id: "6" }]);
});

test("saves the guarded posting body and notifies the dashboard once per job", async () => {
  const first = insertJob(d, { linkedin_job_id: "11" });
  const second = insertJob(d, { linkedin_job_id: "12", link: "https://jobs.example.test/12" });
  const fetchDetails = vi.fn(async (id: string) => posting(`Role ${id} with React.`));
  const { instance, broadcast } = fetcher(fetchDetails);
  await instance.pass();
  expect(fetchDetails.mock.calls).toEqual([["11"], ["12"]]);
  expect([description(first), description(second)]).toEqual(["Role 11 with React.", "Role 12 with React."]);
  expect((d.query("SELECT description_guard_json FROM jobs WHERE id = ?").get(first) as { description_guard_json: string }).description_guard_json).toContain("verdict");
  expect(broadcast.mock.calls).toEqual([[{ type: "changed", table: "jobs" }], [{ type: "changed", table: "jobs" }]]);
});

test("does nothing when every job already has a description", async () => {
  insertJob(d, { linkedin_job_id: "21", description: "From the agent." });
  const fetchDetails = vi.fn();
  await fetcher(fetchDetails).instance.pass();
  expect(fetchDetails).not.toHaveBeenCalled();
});

test("keeps a description saved while LinkedIn was answering", async () => {
  const job = insertJob(d, { linkedin_job_id: "31" });
  const { instance, broadcast } = fetcher(async () => {
    d.query("UPDATE jobs SET description = ? WHERE id = ?").run("Pasted by the user.", job);
    return posting("Fetched text.");
  });
  await instance.pass();
  expect(description(job)).toBe("Pasted by the user.");
  expect(broadcast).not.toHaveBeenCalled();
});

test("waits while the browser is busy and resumes once it is free", async () => {
  vi.useFakeTimers();
  const job = insertJob(d, { linkedin_job_id: "41" });
  let busy = true;
  const fetchDetails = vi.fn(async () => posting("Later."));
  const { instance } = fetcher(fetchDetails, () => busy);
  instance.schedule();
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchDetails).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(description(job)).toBe("Later.");
  instance.close();
});

test("retries failures with a growing wait and gives up after the attempt limit", async () => {
  vi.useFakeTimers();
  insertJob(d, { linkedin_job_id: "51" });
  const fetchDetails = vi.fn(async () => { throw new Error("timeout"); });
  const { instance } = fetcher(fetchDetails);
  await instance.pass();
  expect(fetchDetails).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchDetails).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetchDetails).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetchDetails).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  instance.observe({ type: "changed", table: "jobs" });
  await vi.advanceTimersByTimeAsync(10);
  expect(fetchDetails).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  instance.close();
});

test("counts sign-in notices and empty pages as failures", async () => {
  const job = insertJob(d, { linkedin_job_id: "61" });
  const { instance, broadcast } = fetcher(async () => ({ raw: "LinkedIn login in progress" }));
  await instance.pass();
  expect(description(job)).toBeNull();
  expect(broadcast).not.toHaveBeenCalled();
  instance.close();
});

test("starts on saved jobs and agent sessions, debounced, and ignores other events", async () => {
  vi.useFakeTimers();
  insertJob(d, { linkedin_job_id: "71" });
  const fetchDetails = vi.fn(async () => posting("Text."));
  const { instance } = fetcher(fetchDetails);
  instance.observe({ type: "changed", table: "recruiters" });
  instance.observe(null);
  await vi.advanceTimersByTimeAsync(50);
  expect(fetchDetails).not.toHaveBeenCalled();
  instance.observe({ type: "changed", table: "jobs" });
  await vi.advanceTimersByTimeAsync(5);
  instance.observe({ type: "acp-exit" });
  await vi.advanceTimersByTimeAsync(5);
  expect(fetchDetails).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5);
  expect(fetchDetails).toHaveBeenCalledOnce();
  instance.close();
  instance.observe({ type: "acp-status" });
  await vi.advanceTimersByTimeAsync(50);
  expect(fetchDetails).toHaveBeenCalledOnce();
});

test("a change during a pass starts another pass afterwards", async () => {
  vi.useFakeTimers();
  insertJob(d, { linkedin_job_id: "81" });
  const fetchDetails = vi.fn(async (id: string) => {
    if (id === "81") instance.observe({ type: "changed", table: "jobs" });
    return posting(`Text ${id}.`);
  });
  const { instance } = fetcher(fetchDetails);
  await instance.pass();
  const later = insertJob(d, { linkedin_job_id: "82", link: "https://jobs.example.test/82" });
  await vi.advanceTimersByTimeAsync(10);
  expect(description(later)).toBe("Text 82.");
  instance.close();
});
