import { describe, expect, test } from "vitest";
import * as matcher from "../src/match/matcher.ts";
import * as outreach from "../src/outreach/core.ts";
import * as paths from "../src/paths.ts";
import * as extract from "../src/ats/extract.ts";
import * as atsScoring from "../src/ats/score.ts";
import * as atsStore from "../src/ats/store.ts";
import * as atsVocabulary from "../src/ats/vocabulary.ts";
import { Database } from "../src/db/sqlite.ts";
import { ensureCurrentSchema } from "../src/db/current-schema.ts";

// Bind module exports once so the measured loops do not pay module-runner getter costs.
const { matchLabels } = matcher;
const { dueAction } = outreach;
const { DEFAULT_OUTREACH_CONFIG } = paths;
const { jobKeywords } = extract;
const { atsScore } = atsScoring;
const { documentsToScore, refreshScores } = atsStore;
const { resumeTerms } = atsVocabulary;
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

const stacks = [["C#", ".NET", "ASP.NET Core", "SQL Server"], ["Node.js", "TypeScript", "PostgreSQL", "NestJS"], ["Java", "Spring Boot", "Kafka", "MySQL"],
  ["Python", "FastAPI", "Django", "Redis"], ["React", "Next.js", "Tailwind CSS", "Vitest"], ["Go", "Kubernetes", "Terraform", "AWS"]];
const common = ["Docker", "Git", "CI/CD", "REST", "Scrum", "Microservices", "GraphQL", "Azure"];
const postings = Array.from({ length: 500 }, (_, index) => {
  const stack = stacks[index % stacks.length]!;
  const extra = common.slice(index % 4, (index % 4) + 4);
  return `About the role\nWe build products for synthetic customers. ${"Collaborate with design and product. ".repeat(20)}\n` +
    `Requirements:\n${stack.map(term => `- Experience with ${term}`).join("\n")}\n- ${extra[0]} and ${extra[1]}\n` +
    `Nice to have:\n- ${extra[2]}\n- ${extra[3]}\nBenefits:\nRemote work and learning budget.`;
});
const resumes = stacks.map((stack, index) => `Synthetic Candidate ${index}\nSoftware engineer. ${"Built and operated services for fictional clients. ".repeat(30)}\n` +
  `Skills: ${stack.join(", ")}, ${common.slice(index % 5, (index % 5) + 3).join(", ")}`);
function scoreAll() {
  const terms = resumes.map(resumeTerms);
  let total = 0;
  for (const posting of postings) {
    const keywords = jobKeywords(posting);
    for (const covered of terms) total += atsScore(keywords, covered).score ?? 0;
  }
  return total;
}
function scoredWorkspace() {
  const d = new Database(":memory:");
  d.transaction(() => ensureCurrentSchema(d))();
  const job = d.query("INSERT INTO jobs (title, company_name, description) VALUES ('Engineer', 'Example Corp', ?)");
  for (const posting of postings) job.run(posting);
  resumes.forEach((text, index) => {
    d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES (?, NULL, 'variant', '/synthetic.pdf', 1, ?, '[]')").run(`pdf-${index}`, text);
    d.query("INSERT INTO resume_variants (id, name, role, origin, status, pdf_artifact_id, created_at, updated_at) VALUES (?, ?, 'backend', 'imported', 'ready', ?, 'now', 'now')").run(`v${index}`, `Resume ${index}`, `pdf-${index}`);
  });
  return d;
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

  test("ATS keyword scores", async ({ bench }) => {
    const reference = scoreAll();
    expect(reference).toBeGreaterThan(0);
    await bench("score 500 jobs x 6 resumes", () => {
      scoreAll();
    }).run(runOptions);
    expect(scoreAll()).toBe(reference);
  });

  test("ATS score cache refresh", async ({ bench }) => {
    const d = scoredWorkspace();
    const documents = documentsToScore(d, () => null);
    expect(refreshScores(d, documents)).toBe(3_000);
    await bench("refresh 500 jobs with a warm cache", () => {
      refreshScores(d, documentsToScore(d, () => null));
    }).run(runOptions);
    expect(refreshScores(d, documents)).toBe(0);
    d.close();
  });
});
