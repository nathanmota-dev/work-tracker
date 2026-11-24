import { beforeEach, expect, test, vi } from "vitest";
import { handleGates } from "./http.ts";
import { gateProfile, removeLanguage, saveLanguage, setEligibility } from "./profile-store.ts";
import { jobGate } from "./store.ts";
import { GateError } from "./types.ts";

vi.mock("./profile-store.ts", () => ({ gateProfile: vi.fn(), saveLanguage: vi.fn(), removeLanguage: vi.fn(), setEligibility: vi.fn() }));
vi.mock("./store.ts", () => ({ jobGate: vi.fn() }));

const profile = { languages: [{ id: 1, language: "Spanish", level: "Native", notes: null }], eligibility: null };
const broadcast = vi.fn();
beforeEach(() => {
  for (const write of [gateProfile, saveLanguage, removeLanguage, setEligibility]) vi.mocked(write).mockReturnValue(profile);
});
const call = (path: string, method = "GET", body?: unknown) =>
  handleGates(path, new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), broadcast);

test("reads the profile and the stored check of one job", async () => {
  expect(await (await call("/api/gates/profile")).json()).toEqual(profile);
  vi.mocked(jobGate).mockReturnValue(null);
  expect(await (await call("/api/gates/jobs/7")).json()).toEqual({ gate: null });
  expect(jobGate).toHaveBeenCalledWith(7);
  for (const path of ["/api/gates/jobs/0", "/api/gates/jobs/x", "/api/gates/other"]) expect((await call(path)).status).toBe(404);
  expect(broadcast).not.toHaveBeenCalled();
});

test("saves or removes a language and sets the eligibility, announcing languages and jobs", async () => {
  expect(await (await call("/api/gates/languages", "POST", { language: "Spanish", level: "Native" })).json()).toEqual(profile);
  expect(saveLanguage).toHaveBeenCalledWith({ language: "Spanish", level: "Native" });
  await call("/api/gates/languages", "POST", { action: "remove", id: 1 });
  expect(removeLanguage).toHaveBeenCalledWith({ action: "remove", id: 1 });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "candidate_languages" });
  await call("/api/gates/eligibility", "POST", { eligibility: "needs_permission" });
  expect(setEligibility).toHaveBeenCalledWith("needs_permission");
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "gate_profile" });
  expect(broadcast).toHaveBeenLastCalledWith({ type: "changed", table: "jobs" });
});

test("answers validation errors with their status and rejects bad requests", async () => {
  vi.mocked(saveLanguage).mockImplementationOnce(() => { throw new GateError("Spanish is already in your languages.", 409); });
  const duplicate = await call("/api/gates/languages", "POST", { language: "spanish", level: "C1" });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "Spanish is already in your languages." });
  vi.mocked(jobGate).mockImplementationOnce(() => { throw new GateError("job #9 not found", 404); });
  expect((await call("/api/gates/jobs/9")).status).toBe(404);
  for (const body of ["not json", "[]", "null"]) expect((await call("/api/gates/eligibility", "POST", body)).status).toBe(400);
  expect((await call("/api/gates/profile", "POST", {})).status).toBe(405);
  expect((await call("/api/gates/languages", "DELETE")).status).toBe(405);
  expect((await call("/api/gates/unknown", "POST", {})).status).toBe(404);
  expect(broadcast).not.toHaveBeenCalled();
  vi.mocked(setEligibility).mockImplementationOnce(() => { throw new Error("disk full"); });
  await expect(call("/api/gates/eligibility", "POST", { eligibility: null })).rejects.toThrow("disk full");
});
