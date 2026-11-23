import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { followupCandidates } from "../followups/candidates.ts";
import { listFollowups, saveFollowup } from "../followups/store.ts";
import { FollowupError } from "../followups/types.ts";
import { cliSpies } from "../test/doubles.ts";
import { followupCmd } from "./followup.ts";

vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../followups/candidates.ts", async (original) => ({ ...(await original<typeof import("../followups/candidates.ts")>()), followupCandidates: vi.fn() }));
vi.mock("../followups/store.ts", () => ({ listFollowups: vi.fn(), saveFollowup: vi.fn() }));

let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
  vi.mocked(db).mockReturnValue("db" as never);
});
const body = (text: string) => { vi.mocked(readFileSync).mockReturnValue(text); return "/drafts/body.md"; };

test("save stores the body file with its subject and stage event, then notifies the UI", async () => {
  vi.mocked(saveFollowup).mockReturnValue(7);
  await followupCmd("save", { "application-id": "3", kind: "thank_you", channel: "email", file: body("Hi"), subject: "Thanks", "stage-event": "9" });
  expect(saveFollowup).toHaveBeenCalledWith({ applicationId: 3, kind: "thank_you", channel: "email", body: "Hi", subject: "Thanks", stageEventId: 9 });
  expect(notifyChange).toHaveBeenCalledWith("followup_drafts");
  expect(output.log.mock.calls[0]![0]).toContain("followup draft #7 saved");
  await followupCmd("save", { kind: "follow_up", file: body("Hi"), "stage-event": "x" });
  expect(saveFollowup).toHaveBeenLastCalledWith({ applicationId: Number.NaN, kind: "follow_up", channel: "", body: "Hi", subject: undefined, stageEventId: Number.NaN });
});

test("save explains the cap, missing files and unexpected errors without notifying", async () => {
  await expect(followupCmd("save", { "application-id": "3" })).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: missing required --file (Markdown body of the message)");
  vi.mocked(saveFollowup).mockImplementationOnce(() => { throw new FollowupError("2 follow-ups were already sent for application #3; do not offer a third one.", 409); });
  await expect(followupCmd("save", { "application-id": "3", kind: "follow_up", channel: "email", file: body("x") })).rejects.toThrow();
  expect(output.error).toHaveBeenLastCalledWith("error: 2 follow-ups were already sent for application #3; do not offer a third one.");
  vi.mocked(readFileSync).mockImplementationOnce(() => { throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }); });
  await expect(followupCmd("save", { file: "/missing.md" })).rejects.toThrow();
  expect(output.error).toHaveBeenLastCalledWith("error: ENOENT: no such file");
  vi.mocked(saveFollowup).mockImplementationOnce(() => { throw new Error("disk"); });
  await expect(followupCmd("save", { file: body("x") })).rejects.toThrow();
  expect(output.error).toHaveBeenLastCalledWith("error: Error: disk");
  expect(notifyChange).not.toHaveBeenCalled();
});

test("list prints drafts with their bodies, optionally for one application", async () => {
  vi.mocked(listFollowups).mockReturnValue([{ id: 1, body_md: "Hello" }] as never);
  await followupCmd("list", { "application-id": "3" });
  expect(listFollowups).toHaveBeenCalledWith(3);
  expect(JSON.parse(output.log.mock.calls[0]![0])).toEqual([{ id: 1, body_md: "Hello" }]);
});

test("candidates uses 10 days by default, accepts --days and rejects invalid thresholds", async () => {
  vi.mocked(followupCandidates).mockReturnValue({ days: 10, follow_ups: [], thank_yous: [] });
  await followupCmd("candidates", {});
  expect(followupCandidates).toHaveBeenLastCalledWith("db", { days: 10 });
  await followupCmd("candidates", { days: "21" });
  expect(followupCandidates).toHaveBeenLastCalledWith("db", { days: 21 });
  await expect(followupCmd("candidates", { days: "2" })).rejects.toThrow();
  expect(output.error.mock.calls.at(-1)![0]).toContain("Days without activity must be a whole number from 7");
  vi.mocked(followupCandidates).mockImplementationOnce(() => { throw new Error("locked"); });
  await expect(followupCmd("candidates", {})).rejects.toThrow();
  expect(output.error).toHaveBeenLastCalledWith("error: Error: locked");
});

test("unknown subcommands fail", async () => {
  await expect(followupCmd("send", {})).rejects.toThrow();
  expect(output.error).toHaveBeenCalledWith("error: unknown followup subcommand: send");
});
