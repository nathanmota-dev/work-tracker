import { beforeEach, expect, test, vi } from "vitest";
import { outreachCmd } from "./outreach.ts";
import {
  logAttempt,
  transition,
  checkBlocked,
  dueAttempts,
  blockedForCompany,
  getBudget,
  setBudget,
  notifyOutreach,
  type OutreachAttempt,
} from "../outreach/store.ts";
import { db } from "../db/index.ts";
import { DEFAULT_OUTREACH_CONFIG } from "../paths.ts";
import { withdrawInvitation } from "../mcp/withdraw.ts";
import { cliSpies, databaseDouble } from "../test/doubles.ts";
vi.mock("../outreach/store.ts", () => ({
  logAttempt: vi.fn(),
  transition: vi.fn(),
  checkBlocked: vi.fn(),
  dueAttempts: vi.fn(),
  blockedForCompany: vi.fn(),
  getBudget: vi.fn(),
  setBudget: vi.fn(),
  notifyOutreach: vi.fn(),
}));
vi.mock("../db/index.ts", () => ({ db: vi.fn() }));
vi.mock("../paths.ts", async (original) => {
  const actual = await original<typeof import("../paths.ts")>();
  return {
    ...actual,
    loadOutreachConfig: () => actual.DEFAULT_OUTREACH_CONFIG,
  };
});
vi.mock("../mcp/withdraw.ts", () => ({ withdrawInvitation: vi.fn() }));
const row = {
  id: 1,
  person_name: "One",
  person_username: "one",
  company_name: "Acme",
  company_urn: "42",
  state: "invited",
  next_action_due: "2026-10-17T12:00:00Z",
} as OutreachAttempt;
const budget = {
  id: 1,
  plan: "career",
  credits_remaining: 5,
  reserve_floor: 1,
  credits_used_this_cycle: 0,
  inmail_monthly_allotment: 5,
  inmail_rollover_cap: 15,
  cycle_reset_day: 1,
  last_synced: null,
};
let d: ReturnType<typeof databaseDouble>, output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  output = cliSpies();
  vi.mocked(logAttempt).mockReturnValue(row);
  vi.mocked(transition).mockReset().mockReturnValue(row);
  vi.mocked(checkBlocked).mockReturnValue({ blocked: false });
  vi.mocked(dueAttempts).mockReturnValue([]);
  vi.mocked(blockedForCompany).mockReturnValue([]);
  vi.mocked(getBudget).mockReturnValue(budget);
  vi.mocked(setBudget).mockReturnValue(budget);
  vi.mocked(withdrawInvitation).mockReset().mockResolvedValue(false);
});
test("logging maps defaults and explicit fields, charges only an exact cost of one, then notifies", async () => {
  await outreachCmd("log", { username: "one", "company-urn": "42" });
  expect(logAttempt).toHaveBeenCalledWith({
    username: "one",
    name: undefined,
    companyUrn: "42",
    companyName: undefined,
    jobId: undefined,
    channel: "connect_note",
    costCredits: 0,
    messageBody: undefined,
    state: undefined,
    sourceSkill: undefined,
    recruiterId: undefined,
  });
  expect(notifyOutreach).toHaveBeenCalledOnce();
  await outreachCmd("log", {
    username: "one",
    name: "One",
    "company-urn": "42",
    company: "Acme",
    "job-id": "job",
    channel: "inmail",
    cost: "1",
    message: "hi",
    state: "queued",
    "source-skill": "scout",
    "recruiter-id": "2",
  });
  expect(logAttempt).toHaveBeenLastCalledWith({
    username: "one",
    name: "One",
    companyUrn: "42",
    companyName: "Acme",
    jobId: "job",
    channel: "inmail",
    costCredits: 1,
    messageBody: "hi",
    state: "queued",
    sourceSkill: "scout",
    recruiterId: 2,
  });
  await outreachCmd("log", { username: "one", "company-urn": "42", cost: "2" });
  expect(logAttempt).toHaveBeenLastCalledWith(
    expect.objectContaining({ costCredits: 0 }),
  );
});
test("updates forward reason and propagate illegal transitions as CLI errors", async () => {
  await outreachCmd("update", {
    id: "1",
    state: "accepted",
    reason: "confirmed",
  });
  expect(transition).toHaveBeenCalledWith(1, "accepted", {
    reason: "confirmed",
  });
  expect(notifyOutreach).toHaveBeenCalledOnce();
  vi.mocked(transition).mockImplementationOnce(() => {
    throw new Error("illegal transition");
  });
  await expect(
    outreachCmd("update", { id: "1", state: "accepted" }),
  ).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenCalledWith("error: illegal transition");
  expect(notifyOutreach).toHaveBeenCalledOnce();
});
test("block check gates scripts with nonzero exit; due queue supports a date override and text formatting", async () => {
  await outreachCmd("check", { username: "one", "company-urn": "42" });
  expect(checkBlocked).toHaveBeenCalledWith("one", "42");
  expect(output.log).toHaveBeenCalledWith("OK: one is not blocked for 42");
  vi.mocked(checkBlocked).mockReturnValue({ blocked: true, reason: "manual" });
  await expect(
    outreachCmd("check", { username: "one", "company-urn": "42" }),
  ).rejects.toThrow("exit:1");
  await outreachCmd("due", {});
  expect(output.log).toHaveBeenCalledWith("nothing due");
  vi.mocked(dueAttempts).mockReturnValue([
    { attempt: row, action: { kind: "withdraw", reason: "overdue" } },
  ]);
  await outreachCmd("due", { on: "2026-10-18" });
  expect(dueAttempts).toHaveBeenLastCalledWith(
    d.asDatabase,
    DEFAULT_OUTREACH_CONFIG,
    "2026-10-18T00:00:00.000Z",
  );
  expect(output.log).toHaveBeenCalledWith(
    expect.stringContaining("[WITHDRAW] #1 One (one) @ Acme — invited"),
  );
});
test("list and blocked queries bind filters and print fallback names, cooldowns and permanent blocks", async () => {
  await outreachCmd("list", {});
  expect(d.statement.all).toHaveBeenLastCalledWith({});
  expect(output.log).toHaveBeenCalledWith("no attempts");
  d.statement.all.mockReturnValue([
    { ...row, person_name: null, company_name: null, next_action_due: null },
  ]);
  await outreachCmd("list", { "company-urn": "42", state: "invited" });
  expect(d.statement.all).toHaveBeenLastCalledWith({ $c: "42", $s: "invited" });
  expect(output.log).toHaveBeenCalledWith("#1 one @ 42 — invited");
  await outreachCmd("blocked", { "company-urn": "42" });
  expect(output.log).toHaveBeenCalledWith("no one blocked for 42");
  vi.mocked(blockedForCompany).mockReturnValue([
    { ...row, block_until: "2027-01-01", reason: "manual" },
    { ...row, person_name: null, block_until: null, reason: null },
  ]);
  await outreachCmd("blocked", { "company-urn": "42" });
  expect(output.log).toHaveBeenCalledWith(
    expect.stringContaining("(until 2027-01-01)"),
  );
  expect(output.log).toHaveBeenCalledWith(
    expect.stringContaining("one: invited (permanent)"),
  );
});
test("budget read is silent to subscribers and updates include only supplied fields, including zero", async () => {
  await outreachCmd("budget", {});
  expect(getBudget).toHaveBeenCalledOnce();
  expect(setBudget).not.toHaveBeenCalled();
  expect(notifyOutreach).not.toHaveBeenCalled();
  await outreachCmd("budget", {
    plan: "none",
    remaining: "0",
    allotment: "5",
    "rollover-cap": "15",
    "reserve-floor": "1",
    "reset-day": "2",
  });
  expect(setBudget).toHaveBeenCalledWith({
    plan: "none",
    credits_remaining: 0,
    inmail_monthly_allotment: 5,
    inmail_rollover_cap: 15,
    reserve_floor: 1,
    cycle_reset_day: 2,
  });
  expect(notifyOutreach).toHaveBeenCalledOnce();
});
test.each(["success", "unconfirmed", "failure"])(
  "withdraw %s still records company block and notifies",
  async (mode) => {
    d.statement.get.mockReturnValue(row);
    if (mode === "success")
      vi.mocked(withdrawInvitation).mockResolvedValue(true);
    if (mode === "failure")
      vi.mocked(withdrawInvitation).mockRejectedValue(
        new Error("browser failed"),
      );
    await outreachCmd("withdraw", { id: "1" });
    expect(withdrawInvitation).toHaveBeenCalledWith("one");
    expect(transition).toHaveBeenCalledWith(1, "invite_ignored", {
      reason:
        mode === "success"
          ? "invite withdrawn + company-blocked"
          : "withdrawal unconfirmed; company-blocked (invite may still be pending on LinkedIn)",
    });
    expect(notifyOutreach).toHaveBeenCalledOnce();
  },
);
test("missing required fields, unknown actions and missing withdrawal rows do not notify", async () => {
  for (const [sub, flags] of [
    ["log", {}],
    ["update", {}],
    ["withdraw", {}],
    ["check", {}],
    ["blocked", {}],
    ["missing", {}],
    ["withdraw", { id: "99" }],
  ] as const)
    await expect(outreachCmd(sub, flags)).rejects.toThrow("exit:1");
  expect(notifyOutreach).not.toHaveBeenCalled();
  expect(withdrawInvitation).not.toHaveBeenCalled();
});
