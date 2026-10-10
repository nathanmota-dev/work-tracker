import { beforeEach, expect, test, vi } from "vitest";
import { db, now } from "../db/index.ts";
import { notifyChange } from "../db/notify.ts";
import { DEFAULT_OUTREACH_CONFIG, loadOutreachConfig } from "../paths.ts";
import { databaseDouble } from "../test/doubles.ts";
import {
  blockedForCompany,
  checkBlocked,
  dueAttempts,
  getBudget,
  logAttempt,
  notifyOutreach,
  refundCredit,
  setBudget,
  spendCredit,
  transition,
  type OutreachAttempt,
} from "./store.ts";
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: vi.fn(() => "2026-10-10T12:00:00.000Z"),
}));
vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../paths.ts", async (original) => ({
  ...(await original<typeof import("../paths.ts")>()),
  loadOutreachConfig: vi.fn(),
}));
const NOW = "2026-10-10T12:00:00.000Z";
const attempt = (patch: Partial<OutreachAttempt> = {}): OutreachAttempt => ({
  id: 1,
  person_username: "candidate",
  person_name: null,
  recruiter_id: null,
  company_urn: "42",
  company_name: "Acme",
  job_id: null,
  channel: "connect_note",
  cost_credits: 0,
  credit_refunded: 0,
  refund_eligible_until: null,
  message_body: null,
  state: "invited",
  sent_at: "2026-10-01T12:00:00.000Z",
  accepted_at: null,
  first_msg_at: null,
  replied_at: null,
  withdrawn_at: null,
  closed_at: null,
  followed_up_at: null,
  next_action_due: null,
  block_until: null,
  reason: null,
  source_skill: null,
  created_at: NOW,
  updated_at: NOW,
  ...patch,
});
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(loadOutreachConfig).mockReturnValue(DEFAULT_OUTREACH_CONFIG);
});
test("blocking checks use person/company scope, skip expired blocks and return the active reason", () => {
  const expired = attempt({
      state: "invite_ignored",
      block_until: "2026-10-09T12:00:00.000Z",
    }),
    active = attempt({ id: 2, state: "do_not_contact", reason: "manual" });
  d.statement.all.mockReturnValue([expired, active]);
  expect(checkBlocked("candidate", "42")).toEqual({
    blocked: true,
    attempt: active,
    reason: "do_not_contact (permanent) — manual",
  });
  expect(d.statement.all).toHaveBeenCalledWith({ $u: "candidate", $c: "42" });
  expect(blockedForCompany("42")).toEqual([active]);
  expect(d.statement.all).toHaveBeenLastCalledWith({ $c: "42" });
  d.statement.all.mockReturnValue([expired]);
  expect(checkBlocked("candidate", "42")).toEqual({ blocked: false });
  d.statement.all.mockReturnValue([
    attempt({ state: "invite_ignored", block_until: "2027-01-01T00:00:00Z" }),
  ]);
  expect(checkBlocked("candidate", "42").reason).toBe(
    "invite_ignored until 2027-01-01 — no reason recorded",
  );
});
test("logging uses defaults and literal due dates; paid InMail creates a refund window and spends once", () => {
  const row = attempt();
  d.statement.get.mockReturnValue(row);
  expect(
    logAttempt({
      username: "candidate",
      companyUrn: "42",
      channel: "connect_note",
    }),
  ).toBe(row);
  expect(d.statement.get).toHaveBeenLastCalledWith({
    $u: "candidate",
    $n: null,
    $rid: null,
    $curn: "42",
    $cname: null,
    $job: null,
    $ch: "connect_note",
    $cost: 0,
    $refund: null,
    $body: null,
    $state: "invited",
    $sent: NOW,
    $due: "2026-10-17T12:00:00.000Z",
    $skill: null,
    $now: NOW,
  });
  expect(d.statement.run).not.toHaveBeenCalled();
  logAttempt({
    username: "candidate",
    name: "Person",
    companyUrn: "42",
    companyName: "Acme",
    channel: "inmail",
    costCredits: 1,
    messageBody: "hello",
    jobId: "job",
    recruiterId: 2,
    sourceSkill: "scout",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $cost: 1,
      $refund: "2027-01-08T12:00:00.000Z",
      $n: "Person",
      $rid: 2,
      $job: "job",
      $body: "hello",
      $skill: "scout",
    }),
  );
  expect(d.statement.run).toHaveBeenCalledExactlyOnceWith({ $now: NOW });
  logAttempt({
    username: "candidate",
    companyUrn: "42",
    channel: "connect_note",
    state: "queued",
  });
  expect(d.statement.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      $sent: null,
      $due: null,
      $refund: null,
      $state: "queued",
    }),
  );
});
test("transition rejects missing or illegal attempts and same-state updates make no writes", () => {
  expect(() => transition(1, "accepted")).toThrow("not found");
  const row = attempt();
  d.statement.get.mockReturnValue(row);
  expect(transition(1, "invited")).toBe(row);
  expect(d.query).toHaveBeenCalledTimes(2);
  expect(() => transition(1, "unresponsive")).toThrow(
    "illegal outreach transition",
  );
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(
    d.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE")),
  ).toHaveLength(0);
});
test.each([
  ["invited", "accepted", "2026-10-14T12:00:00.000Z", "accepted_at = COALESCE"],
  [
    "accepted",
    "followed_up",
    "2026-10-17T12:00:00.000Z",
    "followed_up_at = $now",
  ],
  ["invited", "invite_ignored", null, "withdrawn_at = $now"],
  ["followed_up", "unresponsive", null, "closed_at = COALESCE"],
  ["invited", "do_not_contact", null, "closed_at = COALESCE"],
] as const)(
  "%s → %s sets due dates and lifecycle timestamps",
  (from, to, due, timestamp) => {
    const updated = attempt({ state: to });
    d.statement.get
      .mockReturnValueOnce(attempt({ state: from }))
      .mockReturnValueOnce(updated);
    expect(transition(1, to, { reason: "confirmed" })).toBe(updated);
    expect(d.statement.get).toHaveBeenLastCalledWith(
      expect.objectContaining({
        $id: 1,
        $state: to,
        $now: NOW,
        $reason: "confirmed",
        $due: due,
      }),
    );
    expect(d.query).toHaveBeenLastCalledWith(
      expect.stringContaining(timestamp),
    );
    if (["invite_ignored", "unresponsive", "do_not_contact"].includes(to))
      expect(d.statement.get).toHaveBeenLastCalledWith(
        expect.objectContaining({ $bu: "2027-07-10T12:00:00.000Z" }),
      );
  },
);
test("permanent policy writes a null cooldown", () => {
  vi.mocked(loadOutreachConfig).mockReturnValue({
    ...DEFAULT_OUTREACH_CONFIG,
    companyBlock: "permanent",
  });
  d.statement.get.mockReturnValue(attempt());
  transition(1, "do_not_contact");
  expect(d.statement.get).toHaveBeenLastCalledWith(
    expect.objectContaining({ $bu: null }),
  );
});
test.each([
  [1, 0, "2026-10-10T12:00:00.000Z", true],
  [1, 0, null, true],
  [1, 0, "2026-10-10T11:59:59.999Z", false],
  [1, 1, null, false],
  [0, 0, null, false],
] as const)(
  "refund decision for cost=%s refunded=%s window=%s",
  (cost, refunded, until, eligible) => {
    d.statement.get
      .mockReturnValueOnce(
        attempt({
          cost_credits: cost,
          credit_refunded: refunded,
          refund_eligible_until: until,
        }),
      )
      .mockReturnValueOnce(attempt({ state: "engaged" }));
    transition(1, "engaged");
    expect(d.statement.run).toHaveBeenCalledTimes(eligible ? 1 : 0);
    expect(d.query).toHaveBeenLastCalledWith(
      expect.stringContaining("replied_at = COALESCE"),
    );
    expect(d.statement.get).toHaveBeenLastCalledWith({
      $id: 1,
      $state: "engaged",
      $now: NOW,
      $due: null,
    });
    expect(
      String(d.query.mock.calls.at(-1)?.[0]).includes("credit_refunded = 1"),
    ).toBe(eligible);
  },
);
test("due queue filters items using the core cadence and preserves row identity", () => {
  const invited = attempt(),
    accepted = attempt({
      id: 2,
      state: "accepted",
      first_msg_at: "2026-10-01T12:00:00Z",
    }),
    future = attempt({ id: 3, sent_at: NOW });
  d.statement.all.mockReturnValue([invited, accepted, future]);
  expect(
    dueAttempts().map(({ attempt, action }) => [attempt.id, action.kind]),
  ).toEqual([
    [1, "withdraw"],
    [2, "followup"],
  ]);
  expect(now).toHaveBeenCalled();
});
test("budget updates use bounded credit expressions, patch only provided fields and notify outreach", async () => {
  const budget = { id: 1, credits_remaining: 5 };
  d.statement.get.mockReturnValue(budget);
  expect(getBudget()).toBe(budget);
  spendCredit();
  expect(d.query).toHaveBeenLastCalledWith(
    expect.stringContaining("MAX(0, credits_remaining - 1)"),
  );
  refundCredit();
  expect(d.query).toHaveBeenLastCalledWith(
    expect.stringContaining("MIN(inmail_rollover_cap, credits_remaining + 1)"),
  );
  d.statement.run.mockClear();
  setBudget({});
  expect(d.statement.run).not.toHaveBeenCalled();
  expect(setBudget({ credits_remaining: 0, reserve_floor: 2 })).toBe(budget);
  expect(d.statement.run).toHaveBeenCalledWith({
    $now: NOW,
    $credits_remaining: 0,
    $reserve_floor: 2,
  });
  await notifyOutreach();
  expect(notifyChange).toHaveBeenCalledWith("outreach_attempts");
});
