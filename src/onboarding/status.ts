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

function integration(target: Target, verified: Map<string, string>, config: ReturnType<typeof configSnapshot>["config"]): OnboardingItem {
  if (!executable(target)) return { key: target, ready: false, reason: "missing_executable", target };
  if (verified.get(target) !== commandFingerprint(target, config)) return { key: target, ready: false, reason: "untested", target };
  return { key: target, ready: true, target };
}

/** Any tested ACP agent counts; otherwise point at the workspace default first. */
function connectItems(d: Database): OnboardingItem[] {
  let snapshot: ReturnType<typeof configSnapshot>;
  try { snapshot = configSnapshot(); }
  catch { return [{ key: "config", ready: false, reason: "invalid_config" }]; }
  const verified = verifiedFingerprints(d);
  const preferred = `acp/${snapshot.config.provider ?? "opencode"}` as Target;
  const agents = targets.filter(target => target.startsWith("acp/"))
    .sort((a, b) => Number(b === preferred) - Number(a === preferred))
    .map(target => integration(target, verified, snapshot.config));
  const agent = agents.find(item => item.ready) ?? agents.find(item => item.reason === "untested") ?? agents[0]!;
  return [{ ...agent, key: "agent" }, ...(["mcp/linkedin", "mcp/chrome"] as const).map(target => integration(target, verified, snapshot.config))];
}

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
    connect: connectItems(d),
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
  return { steps, hidden: preferences.hidden, completedAt: preferences.completedAt, complete: !next, next };
}
