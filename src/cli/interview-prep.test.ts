import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { notifyChange } from "../db/notify.ts";
import { applicationContext } from "../interview-prep/context.ts";
import { InterviewPrepError, listInterviewPreps, saveInterviewPrep } from "../interview-prep/store.ts";
import { cliSpies } from "../test/doubles.ts";
import { applicationShowCmd, interviewPrepCmd } from "./interview-prep.ts";

vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../interview-prep/context.ts", () => ({ applicationContext: vi.fn() }));
vi.mock("../interview-prep/store.ts", async (original) => ({
  ...(await original<typeof import("../interview-prep/store.ts")>()),
  listInterviewPreps: vi.fn(),
  saveInterviewPrep: vi.fn(),
}));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  vi.clearAllMocks();
  output = cliSpies();
});
const pack = (text: string) => { vi.mocked(readFileSync).mockReturnValue(text); return "/packs/pack.md"; };

test("application show prints the context and fails for unknown or missing ids", () => {
  vi.mocked(applicationContext).mockReturnValueOnce({ id: 3, company: "Acme" } as never);
  applicationShowCmd({ id: "3" });
  expect(JSON.parse(output.log.mock.calls[0][0])).toMatchObject({ id: 3, company: "Acme" });
  expect(() => applicationShowCmd({})).toThrow(); expect(output.error).toHaveBeenCalledWith("error: missing required --id");
  vi.mocked(applicationContext).mockReturnValueOnce(null);
  expect(() => applicationShowCmd({ id: "9" })).toThrow(); expect(output.error).toHaveBeenCalledWith("error: application #9 not found");
});

test("save stores the pack file, notifies the UI and reports the id", async () => {
  vi.mocked(saveInterviewPrep).mockReturnValue(5);
  await interviewPrepCmd("save", { "application-id": "3", stage: "Final", file: pack("# Pack"), when: "2026-12-01", format: "onsite", interviewers: "Ana" });
  expect(saveInterviewPrep).toHaveBeenCalledWith({ applicationId: 3, stage: "Final", body: "# Pack", scheduledAt: "2026-12-01", format: "onsite", interviewers: "Ana" });
  expect(notifyChange).toHaveBeenCalledWith("interview_preps");
  expect(output.log).toHaveBeenCalledWith("interview prep #5 saved");
});

test("save reports missing files, invalid packs and unexpected failures without notifying", async () => {
  await expect(interviewPrepCmd("save", { "application-id": "3", stage: "x" })).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: missing required --file (Markdown pack to store)");
  vi.mocked(readFileSync).mockImplementationOnce(() => { throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }); });
  await expect(interviewPrepCmd("save", { "application-id": "3", stage: "x", file: "/no/such/pack.md" })).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: ENOENT: no such file");
  vi.mocked(saveInterviewPrep).mockImplementationOnce(() => { throw new InterviewPrepError("stage is required"); });
  await expect(interviewPrepCmd("save", { file: pack("x") })).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: stage is required");
  vi.mocked(saveInterviewPrep).mockImplementationOnce(() => { throw new Error("disk"); });
  await expect(interviewPrepCmd("save", { "application-id": "3", stage: "x", file: pack("x") })).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: Error: disk");
  expect(notifyChange).not.toHaveBeenCalled();
});

test("list prints packs without their bodies and unknown subcommands fail", async () => {
  vi.mocked(listInterviewPreps).mockReturnValue([{ id: 1, application_id: 3, stage: "Final", body_md: "12345" }] as never);
  await interviewPrepCmd("list", { "application-id": "3" });
  expect(listInterviewPreps).toHaveBeenCalledWith(3);
  expect(JSON.parse(output.log.mock.calls[0][0])).toEqual([{ id: 1, application_id: 3, stage: "Final", characters: 5 }]);
  await expect(interviewPrepCmd("bogus", {})).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: unknown interview-prep subcommand: bogus");
});
