import { beforeEach, expect, test, vi } from "vitest";
import { runCli } from "./run.ts";
import { initCmd } from "./init.ts";
import { setupCmd } from "./setup.ts";
import { recruiterCmd } from "./recruiter.ts";
import {
  jobCmd,
  metricCmd,
  scoreCmd,
  interviewCmd,
  applicationCmd,
  answerCmd,
  activityCmd,
} from "./records.ts";
import { outreachCmd } from "./outreach.ts";
import { importJourneyCmd } from "./import-journey.ts";
import { matchCmd } from "./match.ts";
import { interviewPrepCmd } from "./interview-prep.ts";
import { detectPortalCmd } from "./detect-portal.ts";
import { exportCmd } from "./export.ts";
import { fetchProfile } from "./fetch-profile.ts";
import { linkedinCmd } from "./linkedin.ts";
import { dashboardCmd } from "../server/index.ts";
import { closeDb } from "../db/index.ts";
import { closeMcp } from "../mcp/linkedin.ts";
import { cliSpies } from "../test/doubles.ts";
vi.mock("./init.ts", () => ({ initCmd: vi.fn() }));
vi.mock("./setup.ts", () => ({ setupCmd: vi.fn() }));
vi.mock("./recruiter.ts", () => ({ recruiterCmd: vi.fn() }));
vi.mock("./records.ts", () => ({
  jobCmd: vi.fn(),
  metricCmd: vi.fn(),
  scoreCmd: vi.fn(),
  interviewCmd: vi.fn(),
  applicationCmd: vi.fn(),
  answerCmd: vi.fn(),
  activityCmd: vi.fn(),
}));
vi.mock("./outreach.ts", () => ({ outreachCmd: vi.fn() }));
vi.mock("./import-journey.ts", () => ({ importJourneyCmd: vi.fn() }));
vi.mock("./match.ts", () => ({ matchCmd: vi.fn() }));
vi.mock("./interview-prep.ts", () => ({ interviewPrepCmd: vi.fn() }));
vi.mock("./detect-portal.ts", () => ({ detectPortalCmd: vi.fn() }));
vi.mock("./export.ts", () => ({ exportCmd: vi.fn() }));
vi.mock("./fetch-profile.ts", () => ({ fetchProfile: vi.fn() }));
vi.mock("./linkedin.ts", () => ({ linkedinCmd: vi.fn() }));
vi.mock("./doctor.ts", () => ({ doctor: () => ({ healthy: true }) }));
vi.mock("../server/index.ts", () => ({ dashboardCmd: vi.fn() }));
vi.mock("../db/index.ts", () => ({ closeDb: vi.fn() }));
vi.mock("../mcp/linkedin.ts", () => ({ closeMcp: vi.fn() }));
let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
});
test.each([[], ["--help"], ["-h"], ["--version"], ["-v"]])(
  "help/version %j returns before dispatch and cleanup",
  async (...argv) => {
    await runCli(argv);
    expect(output.log).toHaveBeenCalledWith(
      expect.stringContaining("work-tracker"),
    );
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeDb).not.toHaveBeenCalled();
  },
);
test.each([
  ["recruiter", recruiterCmd],
  ["job", jobCmd],
  ["interview", interviewCmd],
  ["application", applicationCmd],
  ["answer", answerCmd],
  ["outreach", outreachCmd],
  ["linkedin", linkedinCmd],
] as const)("dispatches %s subcommands and flags", async (command, handler) => {
  await runCli([command, "add", "--name", "Person"]);
  expect(handler).toHaveBeenCalledWith("add", { name: "Person" });
  expect(closeMcp).toHaveBeenCalledOnce();
  expect(closeDb).toHaveBeenCalledOnce();
});
test("dispatches interview-prep subcommands lazily", async () => {
  await runCli(["interview-prep", "save", "--stage", "Final"]);
  expect(interviewPrepCmd).toHaveBeenCalledWith("save", { stage: "Final" });
  expect(closeDb).toHaveBeenCalledOnce();
});
test.each([
  ["metric", metricCmd],
  ["score", scoreCmd],
  ["activity", activityCmd],
  ["setup", setupCmd],
  ["match", matchCmd],
  ["detect-portal", detectPortalCmd],
  ["export", exportCmd],
] as const)(
  "dispatches %s flags without forwarding an implicit subcommand",
  async (command, handler) => {
    await runCli([command, "record", "--value", "3"]);
    expect(handler).toHaveBeenCalledWith({ value: "3" });
    expect(closeDb).toHaveBeenCalledOnce();
  },
);
test.each(["serve", "backend", "dashboard"])(
  "%s leaves resources owned by the server",
  async (command) => {
    await runCli([command, "--port", "1234"]);
    expect(dashboardCmd).toHaveBeenCalledWith({ port: "1234" });
    expect(closeMcp).not.toHaveBeenCalled();
    expect(closeDb).not.toHaveBeenCalled();
  },
);
test("initialization, diagnostics, import and profile dispatch pass their intended arguments", async () => {
  await runCli(["init"]);
  expect(initCmd).toHaveBeenCalledOnce();
  await runCli(["doctor"]);
  expect(output.log).toHaveBeenCalledWith('{\n  "healthy": true\n}');
  await runCli(["import-journey", "/fixture.md"]);
  expect(importJourneyCmd).toHaveBeenCalledWith("/fixture.md");
  await runCli(["fetch-profile", "candidate"]);
  expect(fetchProfile).toHaveBeenCalledWith("candidate");
  await runCli(["recruiter"]);
  expect(recruiterCmd).toHaveBeenCalledWith("", {});
});
test("invalid commands and missing import paths terminate; handler failures propagate to the entrypoint", async () => {
  await expect(runCli(["missing"])).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith(
    expect.stringContaining("unknown command: missing"),
  );
  await expect(runCli(["import-journey"])).rejects.toThrow("exit:1");
  expect(importJourneyCmd).not.toHaveBeenCalled();
  vi.mocked(fetchProfile).mockRejectedValueOnce(new Error("profile failed"));
  await expect(runCli(["fetch-profile"])).rejects.toThrow("profile failed");
  expect(closeDb).not.toHaveBeenCalled();
});
