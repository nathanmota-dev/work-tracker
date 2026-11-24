import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildSkillPrompt, SessionManager } from "./session.ts";

const SKILLS = [
  "job-scout",
  "recruiter-outreach",
  "profile-optimizer",
  "experience-bank",
  "resume-tailor",
  "deep-scout",
  "interview-prep",
  "followup",
  "job-ranking",
  "requirements-check",
];

const DELIM = "\n\n---\nAdditional context from the user (honor this):\n";

describe("buildSkillPrompt — no extra (byte-identical)", () => {
  for (const skill of SKILLS) {
    test(`${skill}: omitted extra unchanged`, () => {
      const without = buildSkillPrompt(skill, {
        query: "q",
        company: "Acme Corp",
        jobIds: "1,2",
      });
      const withEmpty = buildSkillPrompt(skill, {
        query: "q",
        company: "Acme Corp",
        jobIds: "1,2",
        extra: "",
      });
      expect(withEmpty).toBe(without);
      expect(withEmpty).not.toContain("Additional context");
    });
  }

  test("default case with prompt, no extra", () => {
    expect(buildSkillPrompt("unknown-skill", { prompt: "do the thing" })).toBe(
      "do the thing",
    );
  });

  test("whitespace-only extra is a no-op", () => {
    const base = buildSkillPrompt("job-scout", { query: "q" });
    expect(
      buildSkillPrompt("job-scout", { query: "q", extra: "   \n\t " }),
    ).toBe(base);
  });
});

describe("buildSkillPrompt — interview-prep", () => {
  test("names the application and only the details that were given", () => {
    const prompt = buildSkillPrompt("work-tracker-interview-prep", { applicationId: "12", stage: "Final round", date: "2026-12-01", interviewers: "  ", format: "" });
    expect(prompt).toContain("work-tracker-interview-prep skill for application #12");
    expect(prompt).toContain("Stage: Final round. Date: 2026-12-01.");
    expect(prompt).not.toContain("Format");
    expect(prompt).not.toContain("Interviewers");
    expect(prompt).toContain("work-tracker interview-prep save");
  });
  test("flags a missing application id", () => {
    expect(buildSkillPrompt("interview-prep", {})).toContain("(none provided)");
  });
});

describe("buildSkillPrompt — followup", () => {
  test("names the application, the kind and only the details that were given", () => {
    const prompt = buildSkillPrompt("work-tracker-followup", { applicationId: "4", kind: "thank_you", stage: "Technical interview", stageEventId: "17", interviewers: " " });
    expect(prompt).toContain("work-tracker-followup skill to draft a thank-you note (kind thank_you) for application #4");
    expect(prompt).toContain("Stage: Technical interview. Stage event: 17.");
    expect(prompt).not.toContain("Interviewers");
    expect(prompt).toContain("`work-tracker followup save` and never send it");
  });
  test("defaults to a follow-up and flags a missing application id", () => {
    const prompt = buildSkillPrompt("followup", {});
    expect(prompt).toContain("a follow-up (kind follow_up) for application #(none provided).");
  });
});

describe("buildSkillPrompt — job-ranking", () => {
  test("ranks the new roles with the default query", () => {
    const prompt = buildSkillPrompt("work-tracker-job-ranking", {});
    expect(prompt).toContain("work-tracker-job-ranking skill to triage my new saved roles.");
    expect(prompt).toContain("`work-tracker ranking candidates` and store each posting with `work-tracker ranking save`");
    expect(prompt).toContain("triage scores from the posting text only");
  });
  test("passes the selection, a valid limit and all, ignoring invalid values", () => {
    const prompt = buildSkillPrompt("job-ranking", { jobIds: "3, 5,x,0", limit: "20", all: "true" });
    expect(prompt).toContain("the selected jobs #3, #5, re-ranking jobs that were already ranked");
    expect(prompt).toContain("`work-tracker ranking candidates --limit 20 --all --job-ids 3,5`");
    expect(buildSkillPrompt("job-ranking", { limit: "0", all: "yes" })).toContain("`work-tracker ranking candidates` and");
  });
});

describe("buildSkillPrompt — requirements-check", () => {
  test("names the jobs, asks for quotes and never removes a job", () => {
    const prompt = buildSkillPrompt("work-tracker-requirements-check", { jobIds: " 3,5 " });
    expect(prompt).toContain("work-tracker-requirements-check skill for these saved jobs: 3,5.");
    expect(prompt).toContain("`work-tracker job gate`");
    expect(prompt).toContain("Never archive or delete a job.");
    expect(buildSkillPrompt("requirements-check", {})).toContain("saved jobs: (none provided).");
  });
});

describe("buildSkillPrompt — with extra (delimited append)", () => {
  for (const skill of SKILLS) {
    test(`${skill}: appends delimited block once`, () => {
      const params = {
        query: "q",
        company: "Acme Corp",
        jobIds: "1,2",
        extra: "skip crypto",
      };
      const base = buildSkillPrompt(skill, { ...params, extra: "" });
      const out = buildSkillPrompt(skill, params);

      expect(out).toBe(`${base}${DELIM}skip crypto`);
      // exactly one delimiter (no double-append)
      expect(out.split("Additional context from the user").length - 1).toBe(1);
      expect(out.endsWith("skip crypto")).toBe(true);
    });
  }

  test("default (params.prompt) case also gets the extra appended", () => {
    const out = buildSkillPrompt("unknown-skill", {
      prompt: "do the thing",
      extra: "be terse",
    });
    expect(out).toBe(`do the thing${DELIM}be terse`);
  });

  test("extra is trimmed before appending", () => {
    const out = buildSkillPrompt("job-scout", {
      query: "q",
      extra: "  focus remote  ",
    });
    expect(out.endsWith("focus remote")).toBe(true);
    expect(out).not.toContain("  focus remote  ");
  });

  test("multiline extra (e.g. pasted JD) is preserved", () => {
    const jd = "Role: Backend Engineer\nStack: Java, AWS\nRemote: yes";
    const out = buildSkillPrompt("job-scout", { query: "q", extra: jd });
    expect(out).toContain(jd);
  });
});

describe("buildSkillPrompt — profile target", () => {
  test("profile-optimizer includes the configured LinkedIn username when provided", () => {
    const out = buildSkillPrompt("profile-optimizer", {
      username: "candidate-example-000001",
    });
    expect(out).toContain('My LinkedIn username is "candidate-example-000001"');
    expect(out).toContain(
      "https://www.linkedin.com/in/candidate-example-000001/",
    );
    expect(out).toContain(
      'get_person_profile(linkedin_username="candidate-example-000001")',
    );
  });
});

import { AcpClient } from "./client.ts";
import { loadConfig } from "../paths.ts";
import { prepareWorkspace } from "../cli/skills.ts";
import { deferred } from "../test/doubles.ts";
vi.mock("./client.ts", () => ({ AcpClient: vi.fn() }));
vi.mock("../paths.ts", () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock("../cli/skills.ts", () => ({ prepareWorkspace: vi.fn() }));

beforeEach(() => {
  vi.mocked(loadConfig).mockReturnValue({});
  vi.mocked(prepareWorkspace).mockReset();
});
test("all bundled prompt templates handle defaults, prefix and optional context", () => {
  expect(buildSkillPrompt("work-tracker-job-scout", {})).toContain(
    '"software engineer"',
  );
  expect(
    buildSkillPrompt("job-scout", { query: "Node", location: "Brazil" }),
  ).toContain('"Node" in Brazil');
  expect(buildSkillPrompt("recruiter-outreach", {})).toContain(
    "the target companies",
  );
  expect(
    buildSkillPrompt("recruiter-outreach", {
      company: "Acme",
      location: "Brazil",
    }),
  ).toContain("Acme who hire in Brazil");
  expect(buildSkillPrompt("resume-tailor", {})).toContain("(none provided)");
  expect(buildSkillPrompt("outreach-tracker", {})).toContain(
    "request confirmation before sending",
  );
  expect(buildSkillPrompt("portal-filler", {})).toContain(
    "selected application",
  );
  expect(buildSkillPrompt("portal-filler", { jobIds: "1" })).toContain("for 1");
  expect(
    buildSkillPrompt("portal-filler", { url: "https://fixture.invalid" }),
  ).toContain("https://fixture.invalid");
  expect(buildSkillPrompt("unknown", {})).toBe("unknown");
});
test("SessionManager forwards events, uses saved profile and selected model, prevents concurrent runs and cleans up", async () => {
  const pending = deferred();
  const start = vi.fn().mockResolvedValue(undefined),
    prompt = vi.fn(() => pending.promise),
    stop = vi.fn(),
    cancel = vi.fn().mockRejectedValue(new Error("gone"));
  let callbacks!: import("./client.ts").AcpEvents;
  vi.mocked(AcpClient).mockImplementation(function (_provider, _cwd, events) {
    callbacks = events!;
    return { start, prompt, stop, cancel } as unknown as AcpClient;
  });
  vi.mocked(loadConfig).mockReturnValue({
    username: " saved-profile ",
    displayName: "Candidate",
  });
  const sink = vi.fn(),
    manager = new SessionManager("/private", sink);
  const run = manager.run("claude-code", "profile-optimizer", {}, "sonnet");
  expect(manager.isRunning).toBe(true);
  await Promise.resolve();
  expect(AcpClient).toHaveBeenCalledWith(
    "claude-code",
    "/private",
    expect.any(Object),
    "sonnet",
  );
  expect(prompt).toHaveBeenCalledWith(
    expect.stringContaining('username is "saved-profile"'),
  );
  await manager.run("opencode", "job-scout", {});
  expect(AcpClient).toHaveBeenCalledOnce();
  expect(sink).toHaveBeenCalledWith({
    type: "acp-error",
    message: "A skill run is already in progress.",
  });
  callbacks.onUpdate!({ text: "chunk" });
  callbacks.onLog!("line");
  manager.cancel();
  expect(cancel).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  pending.resolve();
  await run;
  expect(manager.isRunning).toBe(false);
  expect(stop).toHaveBeenCalledOnce();
  expect(sink.mock.calls.map(([event]) => event)).toEqual(
    expect.arrayContaining([
      {
        type: "acp-status",
        status: "starting",
        provider: "claude-code",
        skill: "profile-optimizer",
      },
      { type: "acp-status", status: "running", skill: "profile-optimizer" },
      { type: "acp-status", status: "cancelled", skill: "profile-optimizer" },
      { type: "acp-update", update: { text: "chunk" } },
      { type: "acp-log", line: "line" },
    ]),
  );
  manager.stop();
  manager.cancel();
  expect(stop).toHaveBeenCalledOnce();
});
test("SessionManager starts the agent with the selected effort only when one is chosen", async () => {
  const start = vi.fn().mockResolvedValue(undefined);
  vi.mocked(AcpClient).mockImplementation(function () {
    return { start, prompt: vi.fn().mockResolvedValue(undefined), stop: vi.fn() } as unknown as AcpClient;
  });
  const manager = new SessionManager("/private", vi.fn());
  await manager.run("claude-code", "job-scout", {}, "sonnet", "high");
  expect(start).toHaveBeenLastCalledWith({
    command: { cmd: ["claude-code-acp"], env: { CLAUDECODE: "", ANTHROPIC_MODEL: "sonnet", CLAUDE_CODE_EFFORT_LEVEL: "high" } },
  });
  await manager.run("claude-code", "job-scout", {}, "sonnet");
  expect(start).toHaveBeenLastCalledWith({});
});
test("pending login retains the ACP and browser, unrelated tools do not mark it done, and retry reuses the same session", async () => {
  let callbacks!: import("./client.ts").AcpEvents;
  const start = vi.fn().mockResolvedValue(undefined), stop = vi.fn();
  const prompt = vi.fn().mockImplementationOnce(async () => {
    callbacks.onUpdate!({ update: { sessionUpdate: "tool_call", toolCallId: "login", title: "linkedin_get_person_profile", status: "in_progress" } });
    callbacks.onUpdate!({ update: { sessionUpdate: "tool_call_update", toolCallId: "login", status: "failed", content: [{ content: { type: "text", text: "A LinkedIn login window is open and login is still in progress. This is not a failure." } }] } });
    callbacks.onUpdate!({ update: { sessionUpdate: "tool_call", toolCallId: "todo", title: "5 todos", status: "completed" } });
  }).mockImplementationOnce(async () => {
    callbacks.onUpdate!({ update: { sessionUpdate: "tool_call", toolCallId: "retry", title: "linkedin_get_person_profile", status: "in_progress" } });
    callbacks.onUpdate!({ update: { sessionUpdate: "tool_call_update", toolCallId: "retry", status: "completed", content: [{ content: { type: "text", text: "Retrieved profile" } }] } });
  });
  vi.mocked(AcpClient).mockImplementation(function (_provider, _cwd, events) {
    callbacks = events!;
    return { start, prompt, stop } as unknown as AcpClient;
  });
  vi.mocked(loadConfig).mockReturnValue({});
  const sink = vi.fn(), manager = new SessionManager("/private", sink);
  await manager.run("opencode", "profile-optimizer", {});
  expect(manager.isRunning).toBe(false);
  expect(stop).not.toHaveBeenCalled();
  expect(sink).toHaveBeenLastCalledWith({ type: "acp-status", status: "waiting_for_sign_in", skill: "profile-optimizer" });
  await manager.run("opencode", "profile-optimizer", {});
  expect(AcpClient).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledOnce();
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledOnce();
  expect(sink).toHaveBeenLastCalledWith({ type: "acp-status", status: "done", skill: "profile-optimizer" });
});
test.each(["cancel", "stop", "exit", "change provider"])("a retained login session can be released by %s", async action => {
  let callbacks!: import("./client.ts").AcpEvents;
  const stop = vi.fn(), cancel = vi.fn().mockResolvedValue(undefined);
  vi.mocked(AcpClient).mockImplementation(function (_provider, _cwd, events) {
    callbacks = events!;
    return { start: vi.fn().mockResolvedValue(undefined), stop, cancel, prompt: vi.fn(async () => {
      callbacks.onUpdate!({ sessionUpdate: "tool_call", toolCallId: "login", title: "linkedin_get_person_profile", status: "failed", content: [{ content: { type: "text", text: "LinkedIn login in progress" } }] });
    }) } as unknown as AcpClient;
  });
  vi.mocked(loadConfig).mockReturnValue({});
  const sink = vi.fn(), manager = new SessionManager("/private", sink);
  await manager.run("opencode", "profile-optimizer", {});
  const oldCallbacks = callbacks;
  if (action === "exit") {
    callbacks.onExit!(1);
    await manager.run("opencode", "profile-optimizer", {});
    expect(AcpClient).toHaveBeenCalledTimes(2);
  } else if (action === "change provider") {
    await manager.run("claude-code", "profile-optimizer", {});
    expect(stop).toHaveBeenCalledOnce();
    oldCallbacks.onExit!(0); // Late exit from the old process must not clear its replacement.
    await manager.run("claude-code", "profile-optimizer", {});
    expect(AcpClient).toHaveBeenCalledTimes(2);
  } else {
    if (action === "cancel") manager.cancel();
    else manager.stop();
    expect(stop).toHaveBeenCalledOnce();
    if (action === "cancel") expect(sink).toHaveBeenLastCalledWith({ type: "acp-status", status: "cancelled" });
  }
  manager.stop();
});
test("explicit profile overrides saved data and errors reset the manager for the next run", async () => {
  const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("start failed"))
      .mockResolvedValue(undefined),
    prompt = vi.fn().mockRejectedValueOnce("prompt failed"),
    stop = vi.fn();
  vi.mocked(AcpClient).mockImplementation(function () {
    return { start, prompt, stop } as unknown as AcpClient;
  });
  vi.mocked(loadConfig).mockReturnValue({ username: "saved" });
  const sink = vi.fn(),
    manager = new SessionManager("/private", sink);
  await manager.run("opencode", "profile-optimizer", {});
  expect(sink).toHaveBeenCalledWith({
    type: "acp-error",
    message: "start failed",
  });
  expect(manager.isRunning).toBe(false);
  await manager.run("opencode", "profile-optimizer", { username: " chosen " });
  expect(prompt).toHaveBeenCalledWith(
    expect.stringContaining('username is "chosen"'),
  );
  expect(sink).toHaveBeenCalledWith({
    type: "acp-error",
    message: "prompt failed",
  });
  expect(stop).toHaveBeenCalledTimes(2);
});

test("the managed resume-tailor prompt accepts a job profile target as well as a job", () => {
  const prompt = buildSkillPrompt("resume-tailor", { manifestPath: "/runs/v/manifest.json" });
  expect(prompt).toContain('Read the run manifest at "/runs/v/manifest.json"');
  expect(prompt).toContain("The manifest can target a job profile (`target`: a role and stacks) instead of a job (`job`).");
  expect(prompt).toContain("The backend owns compilation and persistence.");
});
