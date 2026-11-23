import { beforeEach, expect, test, vi } from "vitest";
import { db } from "../db/index.ts";
import { dueAttempts, getBudget } from "../outreach/store.ts";
import { databaseDouble } from "../test/doubles.ts";
import { queries } from "./queries.ts";
import { quietApplications } from "../applications/quiet.ts";
import type { QuietApplications } from "../applications/types.ts";
vi.mock("../db/index.ts", () => ({
  db: vi.fn(),
  now: () => "2026-10-10T12:00:00Z",
}));
vi.mock("../applications/quiet.ts", () => ({
  quietApplications: vi.fn(() => ({ days: 60, items: [], skipped: [] })),
}));
vi.mock("../outreach/store.ts", () => ({
  dueAttempts: vi.fn(),
  getBudget: vi.fn(),
}));
let d: ReturnType<typeof databaseDouble>;
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  vi.mocked(dueAttempts).mockReturnValue([]);
});
test("missing profile scans and score return explicit empty states", () => {
  expect(queries.profileSnapshot()).toEqual({ hasScan: false });
  d.statement.get
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce({ recruiters: 0, jobs: 0 });
  expect(queries.overview()).toEqual({
    score: null,
    breakdown: null,
    recruiters: 0,
    jobs: 0,
    journey: expect.objectContaining({ total: 0 }),
    quiet: 0,
    deadlines: [],
  });
  expect(queries.profile()).toBeNull();
});
test.each([
  [null, null],
  ["", null],
  ["3", null],
  [
    '["Headline",{"key":"skills","status":"good"},{"label":"About","value":7},{}]',
    [
      { label: "Headline", value: "" },
      { label: "skills", value: "good" },
      { label: "About", value: "7" },
      { label: "", value: "" },
    ],
  ],
  [
    '{"headline":"ok","skills":{"count":3}}',
    [
      { label: "headline", value: "ok" },
      { label: "skills", value: '{"count":3}' },
    ],
  ],
  ["manual observation", [{ label: "note", value: "manual observation" }]],
] as const)(
  "snapshot converts metrics and parses breakdown %s",
  (raw, expected) => {
    d.statement.get.mockReturnValue({
      captured_at: "2026-10-01",
      search_appearances: 0,
      profile_views: null,
      post_impressions: 40,
      connections: null,
      score: 75,
      breakdown_json: raw,
    });
    expect(queries.profileSnapshot()).toEqual({
      hasScan: true,
      capturedAt: "2026-10-01",
      searchAppearances: 0,
      profileViews: null,
      postImpressions: 40,
      connections: null,
      score: 75,
      breakdown: expected,
    });
  },
);
test("overview merges counts with the latest scored breakdown", () => {
  d.statement.get
    .mockReturnValueOnce({ score: 0, breakdown_json: '{"headline":"missing"}' })
    .mockReturnValueOnce({ recruiters: 5, accepted: 2 });
  expect(queries.overview()).toEqual({
    score: 0,
    breakdown: [{ label: "headline", value: "missing" }],
    recruiters: 5,
    accepted: 2,
    journey: expect.objectContaining({ total: 0 }),
    quiet: 0,
    deadlines: [],
  });
});
test("overview counts quiet applications with the default sweep threshold", () => {
  vi.mocked(quietApplications).mockReturnValueOnce({
    days: 60,
    items: [{ id: 1 }, { id: 2 }] as QuietApplications["items"],
    skipped: [{ id: 3, company_name: null, role_title: null, reason: "Unreadable date" }],
  });
  d.statement.get.mockReturnValueOnce(undefined).mockReturnValueOnce({});
  expect(queries.overview()).toMatchObject({ quiet: 2 });
  expect(quietApplications).toHaveBeenLastCalledWith(d.asDatabase);
});
test("due recruiter actions use username and URN fallbacks", () => {
  vi.mocked(dueAttempts).mockReturnValue([
    {
      attempt: {
        id: 4,
        person_name: null,
        person_username: "one",
        company_name: null,
        company_urn: "42",
        state: "invited",
        next_action_due: "2026-10-01",
      },
      action: { kind: "withdraw", reason: "overdue" },
    },
  ] as ReturnType<typeof dueAttempts>);
  expect(queries.recruitersDue()).toEqual([
    {
      id: 4,
      name: "one",
      username: "one",
      company: "42",
      state: "invited",
      action: "withdraw",
      reason: "overdue",
      due: "2026-10-01",
    },
  ]);
});
test("outreach aggregates active company blocks, default funnel states, due actions and budget", () => {
  d.statement.all
    .mockReturnValueOnce([
      { state: "invited", n: 3 },
      { state: "engaged", n: 1 },
    ])
    .mockReturnValueOnce([
      { company_urn: "a", company_name: "Acme", block_until: null },
      { company_urn: "b", company_name: null, block_until: "2027-01-01" },
      { company_urn: "b", company_name: null, block_until: null },
      {
        company_urn: "expired",
        company_name: "Old",
        block_until: "2026-10-10T12:00:00Z",
      },
      { company_urn: "invalid", company_name: "Old", block_until: "bad" },
    ]);
  vi.mocked(dueAttempts).mockReturnValue([
    {
      attempt: {
        id: 1,
        person_name: "One",
        person_username: "one",
        company_name: "Acme",
        company_urn: "a",
        state: "accepted",
      },
      action: { kind: "followup", reason: "no reply" },
    },
  ] as ReturnType<typeof dueAttempts>);
  vi.mocked(getBudget).mockReturnValue({
    id: 1,
    plan: "career",
    credits_remaining: 2,
    reserve_floor: 1,
    credits_used_this_cycle: 3,
    inmail_monthly_allotment: 5,
    inmail_rollover_cap: 15,
    cycle_reset_day: 1,
    last_synced: null,
  });
  expect(queries.outreach()).toEqual({
    funnel: {
      queued: 0,
      invited: 3,
      accepted: 0,
      followed_up: 0,
      engaged: 1,
      invite_ignored: 0,
      unresponsive: 0,
      do_not_contact: 0,
    },
    due: [
      {
        id: 1,
        person_name: "One",
        person_username: "one",
        company_name: "Acme",
        company_urn: "a",
        state: "accepted",
        actionKind: "followup",
        actionReason: "no reply",
      },
    ],
    blocked: [
      { company_urn: "b", company_name: null, count: 2 },
      { company_urn: "a", company_name: "Acme", count: 1 },
    ],
    budget: {
      plan: "career",
      credits_remaining: 2,
      reserve_floor: 1,
      credits_used_this_cycle: 3,
      inmail_monthly_allotment: 5,
      inmail_rollover_cap: 15,
    },
  });
  expect(dueAttempts).toHaveBeenCalledWith(d.asDatabase);
  expect(getBudget).toHaveBeenCalledWith(d.asDatabase);
});

test.each([
  "recruiters",
  "metrics",
  "interviews",
  "answers",
] as const)("%s forwards rows and supports empty results", (name) => {
  const rows = [{ id: 1 }];
  d.statement.all.mockReturnValueOnce(rows).mockReturnValueOnce([]);
  expect(queries[name]()).toBe(rows);
  expect(queries[name]()).toEqual([]);
  expect(d.statement.all).toHaveBeenCalledWith();
});
test.each(["jobs", "applications"] as const)("%s adds the pending deadline urgency to each row", (name) => {
  const pending = name === "jobs" ? { sent: 0, archived_at: null } : { pending: 1 };
  d.statement.all
    .mockReturnValueOnce([{ id: 1, deadline: "2000-01-01", ...pending }, { id: 2, deadline: null, ...pending }])
    .mockReturnValueOnce([{ id: 3, deadline: "2000-01-01", ...(name === "jobs" ? { sent: 1, archived_at: null } : { pending: 0 }) }])
    .mockReturnValueOnce([]);
  expect(queries[name]()).toEqual([
    expect.objectContaining({ id: 1, deadline_level: "overdue", deadline_days: expect.any(Number) }),
    expect.objectContaining({ id: 2, deadline_level: "none", deadline_days: null }),
  ]);
  const [sent] = queries[name]();
  expect(sent).toMatchObject({ id: 3, deadline_level: "none", deadline_days: null });
  expect(sent).not.toHaveProperty(name === "jobs" ? "sent" : "pending");
  expect(queries[name]()).toEqual([]);
});
test("jobs report the requirement verdict and whether a pass is unverified, never the stored quotes", () => {
  const gate = (verdict: string, unverified: boolean) => JSON.stringify({ verdict, unverified, extraction: { languages: [] }, language: { findings: [{ quote: "Fluent Russian" }] } });
  d.statement.all.mockReturnValueOnce([
    { id: 1, sent: 0, archived_at: null, deadline: null, gate_json: null },
    { id: 2, sent: 0, archived_at: null, deadline: null, gate_json: gate("fail", false) },
    { id: 3, sent: 0, archived_at: null, deadline: null, gate_json: gate("pass", true) },
  ]);
  const rows = queries.jobs() as Record<string, unknown>[];
  expect(rows.map(({ gate_verdict, gate_unverified }) => [gate_verdict, gate_unverified])).toEqual([["unchecked", false], ["fail", false], ["pass", true]]);
  expect(rows.every((row) => !("gate_json" in row))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("Fluent Russian");
});
test("activity binds the default/custom limit and profile returns existing identity", () => {
  d.statement.all.mockReturnValue([{ summary: "saved" }]);
  expect(queries.activity()).toEqual([{ summary: "saved" }]);
  expect(d.statement.all).toHaveBeenLastCalledWith(50);
  queries.activity(7);
  expect(d.statement.all).toHaveBeenLastCalledWith(7);
  d.statement.get.mockReturnValue({ id: 1, name: "Ana" });
  expect(queries.profile()).toEqual({ id: 1, name: "Ana" });
});
