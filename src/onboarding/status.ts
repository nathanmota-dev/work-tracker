import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { ANSWER_CATALOG, resolveAnswer, type AnswerValue } from "../answers/catalog.ts";
import { phaseSql } from "../applications/journey-summary.ts";
import { commandFingerprint, configSnapshot, targets, type Target } from "../integrations/config.ts";
import { executable } from "../integrations/http.ts";
import { dependencyStatus } from "../preparation/latex.ts";
import { snapshotSources, sourcesConfig } from "../preparation/sources.ts";
import { readPreferences, verifiedFingerprints } from "./store.ts";
import { ONBOARDING_STEPS, OPTIONAL_STEPS, type OnboardingItem, type OnboardingStatus, type OnboardingStep, type StepId } from "./types.ts";

/** ACP agents whose current command passed a diagnostic; an unreadable config has none. */
export function readyAgents(d: Database = db()): Target[] {
  let config: ReturnType<typeof configSnapshot>["config"];
  try { config = configSnapshot().config; }
  catch { return []; }
  const verified = verifiedFingerprints(d);
  return targets.filter(target => target.startsWith("acp/"))
    .filter(target => executable(target) && verified.get(target) === commandFingerprint(target, config));
}
export const agentReady = (d: Database = db()): boolean => readyAgents(d).length > 0;

// Many views read the status after each change; reuse one recent tool check.
let tools: { engine: string; at: number; result: ReturnType<typeof dependencyStatus> } | undefined;
function toolStatus(engine: Parameters<typeof dependencyStatus>[0]) {
  if (!tools || tools.engine !== engine || Date.now() - tools.at > 15_000) tools = { engine, at: Date.now(), result: dependencyStatus(engine) };
  return tools.result;
}

async function resumeItems(): Promise<OnboardingItem[]> {
  const config = sourcesConfig();
  let sources: OnboardingItem = { key: "sources", ready: false, reason: "not_configured" };
  if (config.projectDir) {
    try { snapshotSources(config); sources = { key: "sources", ready: true }; }
    catch { sources = { key: "sources", ready: false, reason: "invalid" }; }
  }
  const missing = (await toolStatus(config.engine)).filter(tool => !tool.available).map(tool => tool.command);
  return [sources, { key: "tools", ready: !missing.length, ...(missing.length && { reason: missing.join(", ") }) }];
}

function answerItems(d: Database): OnboardingItem[] {
  const rows = d.query("SELECT key, value FROM applicant_answers").all() as unknown as AnswerValue[];
  return ANSWER_CATALOG.filter(spec => spec.required).map(spec => {
    const { status } = resolveAnswer(rows, spec.key);
    return { key: spec.key, ready: status === "ready", ...(status !== "ready" && { reason: status, target: spec.key }) };
  });
}

function count(d: Database, sql: string): number {
  return Number((d.query(sql).get() as { n: number }).n);
}

/** Calculated from the workspace on every read; only hiding and skipping are stored. */
export async function onboardingStatus(d: Database = db()): Promise<OnboardingStatus> {
  const preferences = readPreferences(d);
  const items: Record<StepId, OnboardingItem[]> = {
    resume: await resumeItems(),
    answers: answerItems(d),
    search: [{ key: "jobs", ready: count(d, "SELECT COUNT(*) AS n FROM jobs") > 0 }],
    apply: [{ key: "applications", ready: count(d, `SELECT COUNT(*) AS n FROM applications a WHERE ${phaseSql()} != 'draft'`) > 0 }],
  };
  const steps = ONBOARDING_STEPS.map((id): OnboardingStep => {
    const optional = OPTIONAL_STEPS.includes(id);
    const done = items[id].every(item => item.ready);
    return { id, optional, items: items[id], state: done ? "done" : optional && preferences.skipped.includes(id) ? "skipped" : "pending" };
  });
  const next = steps.find(step => step.state === "pending")?.id ?? null;
  const agents = readyAgents(d);
  return { agentReady: agents.length > 0, readyAgents: agents, setupCompletedAt: preferences.setupCompletedAt, steps, hidden: preferences.hidden, completedAt: preferences.completedAt, complete: !next, next };
}
