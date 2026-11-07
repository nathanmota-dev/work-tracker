#!/usr/bin/env node
"use strict";

// Microbenchmark gate adapted from Gestão Solo for the Vitest 5 `bench` fixture
// and JSON reporter: blocks throughput losses, removed scenarios and invalid results.
// The baseline is never committed: `--capture` measures the base (main) and
// `--baseline` compares the change with it, on the same machine and in the same run.
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const {
  GateInputError,
  LAYER_NAMES,
  REPOSITORY_ROOT,
  currentCommit,
  markdownEscape,
  readJson,
  verifyArtifact,
  writeJson,
  writeText,
} = require("./ci/common.cjs");

const DEFAULT_POLICY = Object.freeze({ maxRegressionPercent: 20 });
const REPORTS_DIRECTORY = path.join(REPOSITORY_ROOT, "reports");
const RAW_REPORTS_DIRECTORY = path.join(REPORTS_DIRECTORY, "benchmarks");
const MARKDOWN_PATH = path.join(REPORTS_DIRECTORY, "performance.md");
const JSON_PATH = path.join(REPORTS_DIRECTORY, "performance.json");
const METRIC_FIELDS = ["hz", "mean", "median", "rme", "sampleCount"];
const SAME_ENVIRONMENT_FIELDS = ["machine", "node", "platform", "arch", "runId", "runAttempt"];

function assertFiniteMetric(value, label, { positive = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || (positive && value <= 0)) {
    throw new GateInputError(`${label} must be a ${positive ? "positive" : "non-negative"} finite number.`);
  }
  return value;
}

function benchmarkKey(groupName, taskName) {
  return `${groupName} > ${taskName}`;
}

function taskMetrics(task, label) {
  return {
    hz: assertFiniteMetric(task.throughput?.mean, `${label} throughput`, { positive: true }),
    mean: assertFiniteMetric(task.latency?.mean, `${label} mean latency`, { positive: true }),
    median: assertFiniteMetric(task.latency?.p50, `${label} median latency`, { positive: true }),
    rme: assertFiniteMetric(task.throughput?.rme, `${label} relative margin of error`),
    sampleCount: assertFiniteMetric(task.throughput?.samplesCount, `${label} sample count`, { positive: true }),
  };
}

/** Reads `testResults[].assertionResults[].benchmarks[].tasks[]` from the Vitest JSON reporter. */
function extractProjectMetrics(project, report) {
  if (!report || !Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new GateInputError(`${project} benchmark report must contain test results.`);
  }
  if (report.success !== true || report.numFailedTests > 0) {
    throw new GateInputError(`${project} benchmark report contains failed runs or failed result checks.`);
  }
  const benchmarks = {};
  for (const file of report.testResults) {
    if (!Array.isArray(file.assertionResults)) {
      throw new GateInputError(`${project} benchmark report contains a file without assertion results.`);
    }
    for (const assertion of file.assertionResults) {
      if (assertion.status !== "passed") {
        throw new GateInputError(`${project} benchmark "${assertion.fullName}" did not pass its result checks.`);
      }
      if (!Array.isArray(assertion.benchmarks) || assertion.benchmarks.length === 0) {
        throw new GateInputError(`${project} test "${assertion.fullName}" did not record a benchmark.`);
      }
      for (const group of assertion.benchmarks) {
        if (typeof group.name !== "string" || !group.name || !Array.isArray(group.tasks) || group.tasks.length === 0) {
          throw new GateInputError(`${project} benchmark report contains an unnamed or empty benchmark.`);
        }
        for (const task of group.tasks) {
          if (typeof task.name !== "string" || !task.name) {
            throw new GateInputError(`${project} benchmark report contains an unnamed task.`);
          }
          const key = benchmarkKey(group.name, task.name);
          if (Object.hasOwn(benchmarks, key)) {
            throw new GateInputError(`${project} benchmark report contains duplicate benchmark ${key}.`);
          }
          benchmarks[key] = taskMetrics(task, `${project}/${key}`);
        }
      }
    }
  }
  return {
    benchmarks: Object.fromEntries(Object.entries(benchmarks).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function validateProjectMetrics(project, value) {
  if (!value || typeof value !== "object" || !value.benchmarks || typeof value.benchmarks !== "object") {
    throw new GateInputError(`${project} baseline must contain benchmarks.`);
  }
  const entries = Object.entries(value.benchmarks);
  if (entries.length === 0) {
    throw new GateInputError(`${project} baseline must contain at least one benchmark.`);
  }
  for (const [key, metric] of entries) {
    for (const field of METRIC_FIELDS) {
      assertFiniteMetric(metric?.[field], `${project}/${key} baseline ${field}`, { positive: field !== "rme" });
    }
  }
  return value;
}

/** Validates a base measurement for the selected layers; other layers may be absent. */
function validateBaseline(value, projects = LAYER_NAMES) {
  if (!value || value.schemaVersion !== 1) {
    throw new GateInputError("Benchmark baseline must use schemaVersion 1.");
  }
  const limit = assertFiniteMetric(value.policy?.maxRegressionPercent, "policy.maxRegressionPercent", { positive: true });
  if (limit >= 100) {
    throw new GateInputError("policy.maxRegressionPercent must be lower than 100.");
  }
  if (!value.projects || typeof value.projects !== "object") {
    throw new GateInputError("Benchmark baseline must contain projects.");
  }
  for (const project of projects) {
    if (!value.projects[project]) {
      throw new GateInputError(`Benchmark baseline has no ${project} measurement; measure the base with the same layers.`);
    }
    validateProjectMetrics(project, value.projects[project]);
  }
  return value;
}

/** Identifies the machine and runtime so a measurement is only compared with one taken alongside it. */
function machineFingerprint() {
  const cpus = os.cpus();
  return crypto
    .createHash("sha256")
    .update([os.hostname(), cpus[0]?.model ?? "unknown", cpus.length, process.platform, process.arch].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function buildSnapshot(projects, policy = DEFAULT_POLICY, { commit = currentCommit().slice(0, 12), kind = "measurement" } = {}) {
  return {
    schemaVersion: 1,
    kind,
    generatedFromCommit: commit,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      machine: machineFingerprint(),
      runner: process.env.RUNNER_NAME ? `${process.env.RUNNER_OS ?? ""} ${process.env.ImageOS ?? ""}`.trim() : "local",
      runId: process.env.GITHUB_RUN_ID ?? "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
    },
    policy: { maxRegressionPercent: policy.maxRegressionPercent },
    projects: Object.fromEntries(LAYER_NAMES.filter((project) => projects[project]).map((project) => [project, projects[project]])),
  };
}

/** Rejects baselines from another machine, Node version or CI run: they measure the hardware, not the change. */
function assertSameEnvironment(baseline, current) {
  for (const field of SAME_ENVIRONMENT_FIELDS) {
    const expected = current.runtime[field];
    const found = baseline.runtime?.[field];
    if (found !== expected) {
      throw new GateInputError(
        `Benchmark baseline was measured in another environment (${field}: expected ${expected}, found ${found ?? "none"}). `
        + "Measure the base and the change on the same machine in the same run; locally, use npm run performance:check.",
      );
    }
  }
}

function compareBenchmarks(baseline, current, selectedProjects) {
  const results = [];
  const failures = [];
  const warnings = [];
  const limit = baseline.policy.maxRegressionPercent;
  for (const project of selectedProjects) {
    const before = baseline.projects[project]?.benchmarks ?? {};
    const now = current.projects[project]?.benchmarks ?? {};
    for (const [key, baselineMetric] of Object.entries(before)) {
      const currentMetric = now[key];
      if (!currentMetric) {
        failures.push(`${project}/${key} was removed or did not run.`);
        results.push({ project, key, baseline: baselineMetric, current: null, changePercent: null, status: "missing" });
        continue;
      }
      const changePercent = ((currentMetric.hz - baselineMetric.hz) / baselineMetric.hz) * 100;
      const status = changePercent < -limit ? "regression" : "pass";
      if (status === "regression") {
        failures.push(`${project}/${key} lost ${Math.abs(changePercent).toFixed(2)}% throughput (limit ${limit}%).`);
      }
      results.push({ project, key, baseline: baselineMetric, current: currentMetric, changePercent, status });
    }
    for (const [key, currentMetric] of Object.entries(now)) {
      if (Object.hasOwn(before, key)) continue;
      warnings.push(`${project}/${key} is new and does not exist in the base yet.`);
      results.push({ project, key, baseline: null, current: currentMetric, changePercent: null, status: "new" });
    }
  }
  return { passed: failures.length === 0, results, failures, warnings };
}

function formatHz(value) {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function renderMarkdown({ baseline, current, comparison, selectedProjects, baselineLabel }) {
  const status = comparison.passed
    ? "**PASS** — No blocking microbenchmark regression was detected."
    : "**FAIL** — One or more blocking microbenchmark regressions were detected.";
  const runtime = current?.runtime;
  const lines = [
    "# Performance",
    "",
    status,
    "",
    `Baseline: ${markdownEscape(baselineLabel)} · change: \`${markdownEscape(current?.generatedFromCommit ?? "—")}\` · limit: \`${baseline.policy.maxRegressionPercent}%\` throughput loss.`,
  ];
  if (runtime) {
    lines.push("", `Both measurements ran on the same machine: \`${markdownEscape(runtime.runner)}\`, Node \`${markdownEscape(runtime.node)}\`, \`${markdownEscape(runtime.platform)}/${markdownEscape(runtime.arch)}\`.`);
  }
  lines.push(
    "",
    "| Layer | Benchmark | Baseline ops/s | Current ops/s | Change | RME | Result |",
    "|---|---|---:|---:|---:|---:|---|",
  );
  const labels = { pass: "Pass", regression: "Regression", missing: "Missing", new: "New" };
  for (const result of comparison.results) {
    const change = result.changePercent == null ? "—" : `${result.changePercent >= 0 ? "+" : ""}${result.changePercent.toFixed(2)}%`;
    const rme = result.current ? `±${result.current.rme.toFixed(2)}%` : "—";
    lines.push(`| ${markdownEscape(result.project)} | ${markdownEscape(result.key)} | ${formatHz(result.baseline?.hz)} | ${formatHz(result.current?.hz)} | ${change} | ${rme} | ${labels[result.status]} |`);
  }
  if (comparison.results.length === 0) {
    lines.push("| — | No benchmark-relevant layer changed | — | — | — | — | Skipped |");
  }
  if (comparison.failures.length) lines.push("", "## Failures", "", ...comparison.failures.map((item) => `- ${markdownEscape(item)}`));
  if (comparison.warnings.length) lines.push("", "## Warnings", "", ...comparison.warnings.map((item) => `- ${markdownEscape(item)}`));
  const skipped = LAYER_NAMES.filter((project) => !selectedProjects.includes(project));
  lines.push(
    "",
    `Selected layers: ${selectedProjects.length ? selectedProjects.map((item) => `\`${item}\``).join(", ") : "none"}.`,
    `Skipped layers: ${skipped.length ? skipped.map((item) => `\`${item}\``).join(", ") : "none"}.`,
    "",
  );
  return lines.join("\n");
}

function isInsideRepository(target) {
  const relative = path.relative(REPOSITORY_ROOT, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new GateInputError(`${flag} requires a value.`);
  return value;
}

function parseArguments(args, env = process.env) {
  const options = {
    capturePath: null,
    label: env.BENCHMARK_BASELINE_LABEL || null,
    projects: [...LAYER_NAMES],
    baselinePath: env.BENCHMARK_BASELINE_PATH ? path.resolve(REPOSITORY_ROOT, env.BENCHMARK_BASELINE_PATH) : null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--projects") {
      const value = args[++index];
      if (value === undefined) throw new GateInputError("--projects requires a comma-separated value.");
      options.projects = [...new Set(value.split(",").filter(Boolean))];
    } else if (argument === "--baseline") {
      options.baselinePath = path.resolve(REPOSITORY_ROOT, requireValue(args, ++index, argument));
    } else if (argument === "--capture") {
      options.capturePath = path.resolve(REPOSITORY_ROOT, requireValue(args, ++index, argument));
    } else if (argument === "--label") {
      options.label = requireValue(args, ++index, argument);
    } else {
      throw new GateInputError(`Unknown argument: ${argument}`);
    }
  }
  const invalid = options.projects.find((project) => !LAYER_NAMES.includes(project));
  if (invalid) throw new GateInputError(`Unknown benchmark layer: ${invalid}.`);
  if (options.capturePath && isInsideRepository(options.capturePath)) {
    throw new GateInputError("Base measurements must be written outside the repository so they are never committed.");
  }
  if (options.capturePath && options.baselinePath) {
    throw new GateInputError("Use either --capture or --baseline, not both.");
  }
  if (!options.capturePath && !options.baselinePath && options.projects.length > 0) {
    throw new GateInputError(
      "A base measurement from this machine is required (--baseline or BENCHMARK_BASELINE_PATH). Locally, run npm run performance:check.",
    );
  }
  return options;
}

function collectCurrentProjects(selectedProjects) {
  return Object.fromEntries(selectedProjects.map((project) => {
    const reportPath = path.join(RAW_REPORTS_DIRECTORY, `${project}.json`);
    verifyArtifact(reportPath, { layer: project, kind: "benchmark", label: `${project} benchmark report` });
    return [project, extractProjectMetrics(project, readJson(reportPath, `${project} benchmark report`))];
  }));
}

function writeReports(markdown, payload) {
  writeText(MARKDOWN_PATH, markdown);
  writeJson(JSON_PATH, payload);
  process.stdout.write(markdown);
}

/** Records the current tree's measurement as the base for a later comparison. */
function capture(options) {
  const snapshot = buildSnapshot(collectCurrentProjects(options.projects));
  writeJson(options.capturePath, snapshot);
  const count = Object.values(snapshot.projects).reduce((total, project) => total + Object.keys(project.benchmarks).length, 0);
  process.stdout.write(
    `Captured ${count} benchmark(s) from ${snapshot.generatedFromCommit} (${options.projects.join(", ") || "no layers"}) at ${options.capturePath}.\n`,
  );
  return 0;
}

function compare(options) {
  const collected = collectCurrentProjects(options.projects);
  const baseline = options.baselinePath
    ? validateBaseline(readJson(options.baselinePath, "benchmark baseline"), options.projects)
    : buildSnapshot({}, DEFAULT_POLICY, { kind: "empty" });
  const current = buildSnapshot(collected, baseline.policy);
  if (options.projects.length > 0) assertSameEnvironment(baseline, current);
  const comparison = compareBenchmarks(baseline, current, options.projects);
  const baselineLabel = options.label || `${baseline.generatedFromCommit} (measured on this machine)`;
  writeReports(
    renderMarkdown({ baseline, current, comparison, selectedProjects: options.projects, baselineLabel }),
    {
      schemaVersion: 1,
      status: comparison.passed ? "pass" : "fail",
      baseline: { label: baselineLabel, ...baseline },
      current,
      comparison,
    },
  );
  return comparison.passed ? 0 : 1;
}

function runCli(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    return options.capturePath ? capture(options) : compare(options);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    writeText(MARKDOWN_PATH, `# Performance\n\n**ERROR** — Microbenchmark results could not be collected or validated.\n\n## Failure\n\n- ${markdownEscape(normalized.message)}\n`);
    writeJson(JSON_PATH, { schemaVersion: 1, status: "error", error: normalized.message });
    process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
    return 2;
  }
}

module.exports = {
  DEFAULT_POLICY,
  assertSameEnvironment,
  benchmarkKey,
  buildSnapshot,
  compareBenchmarks,
  extractProjectMetrics,
  parseArguments,
  renderMarkdown,
  runCli,
  validateBaseline,
};

if (require.main === module) process.exitCode = runCli();
