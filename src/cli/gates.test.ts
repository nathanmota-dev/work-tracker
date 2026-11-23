import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { notifyChange } from "../db/notify.ts";
import { gateProfile, removeLanguage, saveLanguage, setEligibility } from "../gates/profile-store.ts";
import { jobGate, saveGate } from "../gates/store.ts";
import { GateError, type StoredGate } from "../gates/types.ts";
import { cliSpies } from "../test/doubles.ts";
import { gatesCmd, jobGateCmd } from "./gates.ts";

vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../gates/profile-store.ts", () => ({ gateProfile: vi.fn(), saveLanguage: vi.fn(), removeLanguage: vi.fn(), setEligibility: vi.fn() }));
vi.mock("../gates/store.ts", () => ({ jobGate: vi.fn(), saveGate: vi.fn() }));

const profile = { languages: [{ id: 4, language: "Spanish", level: "Native", notes: null }], eligibility: null };
let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
  for (const read of [gateProfile, saveLanguage, removeLanguage, setEligibility]) vi.mocked(read).mockReturnValue(profile);
});
const printed = () => JSON.parse(String(output.log.mock.calls.at(-1)![0])) as unknown;

test("prints the profile as JSON", async () => {
  await gatesCmd(["profile"], {});
  expect(printed()).toEqual(profile);
  expect(notifyChange).not.toHaveBeenCalled();
});

test("language save adds a new name and updates a declared one by name, then notifies", async () => {
  await gatesCmd(["language", "save"], { language: "English", level: "B1/B2", notes: "Work calls" });
  expect(saveLanguage).toHaveBeenLastCalledWith({ id: undefined, language: "English", level: "B1/B2", notes: "Work calls" });
  await gatesCmd(["language", "save"], { language: " spanish ", level: "C2" });
  expect(saveLanguage).toHaveBeenLastCalledWith({ id: 4, language: " spanish ", level: "C2", notes: undefined });
  await gatesCmd(["language", "save"], { level: "C2" });
  expect(saveLanguage).toHaveBeenLastCalledWith({ id: undefined, language: undefined, level: "C2", notes: undefined });
  expect(notifyChange).toHaveBeenCalledWith("candidate_languages");
  expect(notifyChange).toHaveBeenCalledWith("jobs");
  expect(printed()).toEqual(profile);
});

test("language remove and eligibility set write through the profile store", async () => {
  await gatesCmd(["language", "remove"], { language: "Spanish" });
  expect(removeLanguage).toHaveBeenCalledWith({ language: "Spanish" });
  await gatesCmd(["eligibility", "set"], { status: "none" });
  expect(setEligibility).toHaveBeenCalledWith("none");
  expect(notifyChange).toHaveBeenCalledWith("gate_profile");
});

test("reports validation errors and unknown subcommands", async () => {
  vi.mocked(setEligibility).mockImplementationOnce(() => { throw new GateError("eligibility must be one of: citizen_or_resident, needs_permission or none"); });
  await expect(gatesCmd(["eligibility", "set"], {})).rejects.toThrow("exit:1");
  expect(setEligibility).toHaveBeenCalledWith(undefined);
  expect(output.error).toHaveBeenLastCalledWith("error: eligibility must be one of: citizen_or_resident, needs_permission or none");
  for (const args of [[], ["language"], ["language", "edit"], ["eligibility"]]) {
    await expect(gatesCmd(args, {})).rejects.toThrow("exit:1");
    expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining("unknown gates subcommand"));
  }
  vi.mocked(gateProfile).mockImplementationOnce(() => { throw new Error("db locked"); });
  await expect(gatesCmd(["profile"], {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: Error: db locked");
});

test("job gate stores the extraction file and prints the verdict", async () => {
  const extraction = { languages: [], eligibility: {} };
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(extraction));
  vi.mocked(saveGate).mockReturnValue({ verdict: "pass", unverified: true, language: { status: "off" }, eligibility: { status: "pass" } } as StoredGate);
  await jobGateCmd({ id: "5", file: "/work/gate.json" });
  expect(readFileSync).toHaveBeenCalledWith("/work/gate.json", "utf8");
  expect(saveGate).toHaveBeenCalledWith(5, extraction);
  expect(notifyChange).toHaveBeenCalledWith("jobs");
  expect(output.log.mock.calls[0]![0]).toBe("job #5 requirements: pass (unverified)");
  expect(printed()).toEqual({ verdict: "pass", unverified: true, language: { status: "off" }, eligibility: { status: "pass" } });
  vi.mocked(saveGate).mockReturnValueOnce({ verdict: "fail", unverified: false } as StoredGate);
  await jobGateCmd({ id: "5", file: "/work/gate.json" });
  expect(output.log).toHaveBeenCalledWith("job #5 requirements: fail");
});

test("job gate without a file prints the stored check, or unchecked", async () => {
  vi.mocked(jobGate).mockReturnValueOnce(null);
  await jobGateCmd({ id: "3" });
  expect(printed()).toEqual({ verdict: "unchecked" });
  vi.mocked(jobGate).mockReturnValueOnce({ verdict: "flag" } as StoredGate);
  await jobGateCmd({ id: "3" });
  expect(printed()).toEqual({ verdict: "flag" });
});

test("job gate explains a bad id, missing quote, missing file and invalid JSON without notifying", async () => {
  for (const id of [undefined, "0", "x"]) {
    await expect(jobGateCmd(id ? { id } : {})).rejects.toThrow("exit:1");
    expect(output.error).toHaveBeenLastCalledWith("error: Expected a positive job id (--id).");
  }
  vi.mocked(readFileSync).mockReturnValue("{}");
  vi.mocked(saveGate).mockImplementationOnce(() => { throw new GateError('languages[0] (Polish) needs the literal posting text in "quote": copy the line that states it.'); });
  await expect(jobGateCmd({ id: "2", file: "/x.json" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith('error: languages[0] (Polish) needs the literal posting text in "quote": copy the line that states it.');
  vi.mocked(readFileSync).mockImplementationOnce(() => { throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }); });
  await expect(jobGateCmd({ id: "2", file: "/missing.json" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: ENOENT: no such file");
  vi.mocked(readFileSync).mockReturnValueOnce("{oops");
  await expect(jobGateCmd({ id: "2", file: "/bad.json" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith(expect.stringContaining("error: the extraction file is not valid JSON"));
  expect(notifyChange).not.toHaveBeenCalled();
});
