import { describe, expect, test } from "vitest";
import * as matcher from "../src/match/matcher.ts";
import * as outreach from "../src/outreach/core.ts";
import * as paths from "../src/paths.ts";

// Bind module exports once so the measured loops do not pay module-runner getter costs.
const { matchLabels } = matcher;
const { dueAction } = outreach;
const { DEFAULT_OUTREACH_CONFIG } = paths;
type MatchResult = matcher.MatchResult;
type AttemptLike = outreach.AttemptLike;

// Fixed synthetic inputs keep every run comparable across commits and runners.
const runOptions = { time: 1_000, warmupTime: 300, warmupIterations: 10 };
const fieldLabels = [
  "First name",
  "Last Name *",
  "Email address",
  "Phone number",
  "LinkedIn profile URL",
  "GitHub",
  "Current location",
  "Salary expectations",
  "Notice period",
  "Favourite colour",
];
const atsLabels = Array.from({ length: 100 }, (_, index) => fieldLabels[index % fieldLabels.length]!);
const answers = {
  first_name: "Alex",
  last_name: "Example",
  email: "alex@example.test",
  phone: "+1 555 0100",
  linkedin_url: "https://www.linkedin.com/in/example/",
  github_url: "https://github.com/example",
  location: "Remote",
};

const now = "2026-01-15T12:00:00.000Z";
const daysAgo = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();
const attemptShapes: AttemptLike[] = [
  { state: "invited", sent_at: daysAgo(10), first_msg_at: null, followed_up_at: null, block_until: null },
  { state: "invited", sent_at: daysAgo(2), first_msg_at: null, followed_up_at: null, block_until: null },
  { state: "accepted", sent_at: daysAgo(12), first_msg_at: daysAgo(5), followed_up_at: null, block_until: null },
  { state: "followed_up", sent_at: daysAgo(20), first_msg_at: daysAgo(15), followed_up_at: daysAgo(8), block_until: null },
  { state: "engaged", sent_at: daysAgo(20), first_msg_at: daysAgo(15), followed_up_at: null, block_until: null },
];
const attempts = Array.from({ length: 10_000 }, (_, index) => attemptShapes[index % attemptShapes.length]!);

function summarize(result: MatchResult) {
  return {
    matched: result.matched.map(({ label, key }) => `${label}:${key}`),
    unfilled: result.unfilled.map(({ label, skip }) => `${label}:${skip}`),
  };
}
function evaluateOutreach() {
  const counts = { withdraw: 0, followup: 0, close: 0 };
  for (const attempt of attempts) {
    const action = dueAction(attempt, DEFAULT_OUTREACH_CONFIG, now);
    if (action) counts[action.kind] += 1;
  }
  return counts;
}

describe("backend hot paths", () => {
  test("ATS field matching", async ({ bench }) => {
    const reference = summarize(matchLabels(atsLabels, { answers }));
    expect(reference.matched.length + reference.unfilled.length).toBe(100);
    expect(reference.matched).toContain("Email address:email");
    expect(reference.unfilled).toContain("Favourite colour:no-match");
    await bench("match 100 ATS fields", () => {
      matchLabels(atsLabels, { answers });
    }).run(runOptions);
    expect(summarize(matchLabels(atsLabels, { answers }))).toEqual(reference);
  });

  test("outreach due-action evaluation", async ({ bench }) => {
    expect(evaluateOutreach()).toEqual({ withdraw: 2_000, followup: 2_000, close: 2_000 });
    await bench("evaluate 10000 outreach attempts", () => {
      evaluateOutreach();
    }).run(runOptions);
  });
});
