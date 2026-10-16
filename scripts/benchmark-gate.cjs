#!/usr/bin/env node
"use strict";

// Microbenchmark gate adapted from Gestão Solo for the Vitest 5 `bench` fixture
// and JSON reporter: blocks throughput losses, removed scenarios and invalid results.
const fs = require("node:fs");
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
const DEFAULT_BASELINE_PATH = path.join(__dirname, "benchmark-baseline.json");
const REPORTS_DIRECTORY = path.join(REPOSITORY_ROOT, "reports");
const RAW_REPORTS_DIRECTORY = path.join(REPORTS_DIRECTORY, "benchmarks");
const MARKDOWN_PATH = path.join(REPORTS_DIRECTORY, "performance.md");
const JSON_PATH = path.join(REPORTS_DIRECTORY, "performance.json");
const CANDIDATE_BASELINE_PATH = path.join(REPORTS_DIRECTORY, "benchmark-candidate-baseline.json");
const METRIC_FIELDS = ["hz", "mean", "median", "rme", "sampleCount"];

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

function validateBaseline(value) {
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
  for (const project of LAYER_NAMES) validateProjectMetrics(project, value.projects[project]);
  return value;
}

function buildSnapshot(projects, policy = DEFAULT_POLICY, { commit = currentCommit().slice(0, 12), kind = "candidate" } = {}) {
  return {
    schemaVersion: 1,
    kind,
    generatedFromCommit: commit,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      runner: process.env.RUNNER_NAME ? `${process.env.RUNNER_OS ?? ""} ${process.env.ImageOS ?? ""}`.trim() : "local",
      runId: process.env.GITHUB_RUN_ID ?? "local",
    },
    policy: { maxRegressionPercent: policy.maxRegressionPercent },
    projects: Object.fromEntries(LAYER_NAMES.filter((project) => projects[project]).map((project) => [project, projects[project]])),
  };
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
      warnings.push(`${project}/${key} is new and has no trusted baseline yet.`);
      results.push({ project, key, baseline: null, current: currentMetric, changePercent: null, status: "new" });
    }
  }
  return { passed: failures.length === 0, results, failures, warnings };
}

function formatHz(value) {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function renderMarkdown({ baseline, comparison, selectedProjects, baselineLabel, bootstrap = false }) {
  const status = bootstrap
    ? "**PASS** — Bootstrap reference captured on this runner. Commit `reports/benchmark-candidate-baseline.json` as `scripts/benchmark-baseline.json` to start blocking comparisons."
    : comparison.passed
      ? "**PASS** — No blocking microbenchmark regression was detected."
      : "**FAIL** — One or more blocking microbenchmark regressions were detected.";
  const lines = [
    "# Performance",
    "",
    status,
    "",
    `Baseline: \`${markdownEscape(baselineLabel)}\` · limit: \`${baseline.policy.maxRegressionPercent}%\` throughput loss.`,
    "",
    "| Layer | Benchmark | Baseline ops/s | Current ops/s | Change | RME | Result |",
    "|---|---|---:|---:|---:|---:|---|",
  ];
  const labels = { pass: "Pass", regression: "Regression", missing: "Missing", new: bootstrap ? "Captured" : "New" };
  for (const result of comparison.results) {
    const change = result.changePercent == null ? "—" : `${result.changePercent >= 0 ? "+" : ""}${result.changePercent.toFixed(2)}%`;
    const rme = result.current ? `±${result.current.rme.toFixed(2)}%` : "—";
    lines.push(`| ${markdownEscape(result.project)} | ${markdownEscape(result.key)} | ${formatHz(result.baseline?.hz)} | ${formatHz(result.current?.hz)} | ${change} | ${rme} | ${labels[result.status]} |`);
  }
  if (comparison.results.length === 0) {
    lines.push("| — | No benchmark-relevant layer changed | — | — | — | — | Skipped |");
  }
  if (comparison.failures.length) lines.push("", "## Failures", "", ...comparison.failures.map((item) => `- ${markdownEscape(item)}`));
  if (!bootstrap && comparison.warnings.length) lines.push("", "## Warnings", "", ...comparison.warnings.map((item) => `- ${markdownEscape(item)}`));
  const skipped = LAYER_NAMES.filter((project) => !selectedProjects.includes(project));
  lines.push(
    "",
    `Selected layers: ${selectedProjects.length ? selectedProjects.map((item) => `\`${item}\``).join(", ") : "none"}.`,
    `Skipped layers: ${skipped.length ? skipped.map((item) => `\`${item}\``).join(", ") : "none"}.`,
    "",
  );
  return lines.join("\n");
}

function parseArguments(args) {
  const options = {
    bootstrap: false,
    updateBaseline: false,
    projects: [...LAYER_NAMES],
    baselinePath: process.env.BENCHMARK_BASELINE_PATH || DEFAULT_BASELINE_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--bootstrap") {
      options.bootstrap = true;
    } else if (argument === "--update-baseline") {
      options.updateBaseline = true;
    } else if (argument === "--projects") {
      const value = args[++index];
      if (value === undefined) throw new GateInputError("--projects requires a comma-separated value.");
      options.projects = [...new Set(value.split(",").filter(Boolean))];
    } else if (argument === "--baseline") {
      const value = args[++index];
      if (!value) throw new GateInputError("--baseline requires a path.");
      options.baselinePath = path.resolve(REPOSITORY_ROOT, value);
    } else {
      throw new GateInputError(`Unknown argument: ${argument}`);
    }
  }
  const invalid = options.projects.find((project) => !LAYER_NAMES.includes(project));
  if (invalid) throw new GateInputError(`Unknown benchmark layer: ${invalid}.`);
  if ((options.bootstrap || options.updateBaseline) && options.projects.length !== LAYER_NAMES.length) {
    throw new GateInputError("Capturing a benchmark baseline requires both layers.");
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

function runCli(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    if (options.updateBaseline && process.env.CI === "true") {
      throw new GateInputError("Benchmark baseline updates are disabled in CI.");
    }
    if (!options.bootstrap && !options.updateBaseline && !fs.existsSync(options.baselinePath) && process.env.CI !== "true") {
      // Until a CI-produced reference is committed, local runs only capture one.
      process.stdout.write(`No benchmark baseline at ${path.relative(REPOSITORY_ROOT, options.baselinePath)}; running in bootstrap mode.\n`);
      options.bootstrap = true;
      options.projects = [...LAYER_NAMES];
    }
    const collected = collectCurrentProjects(options.projects);
    if (options.bootstrap || options.updateBaseline) {
      const kind = options.bootstrap ? "bootstrap" : "reviewed";
      const current = buildSnapshot(collected, DEFAULT_POLICY, { kind });
      const comparison = compareBenchmarks({ ...current, projects: {} }, current, options.projects);
      comparison.warnings = [];
      writeJson(CANDIDATE_BASELINE_PATH, current);
      if (options.updateBaseline) writeJson(options.baselinePath, current);
      const label = options.bootstrap ? "bootstrap (no reference in the PR base)" : path.relative(REPOSITORY_ROOT, options.baselinePath);
      writeReports(
        renderMarkdown({ baseline: current, comparison, selectedProjects: options.projects, baselineLabel: label, bootstrap: true }),
        { schemaVersion: 1, status: kind, current, comparison },
      );
      return 0;
    }
    if (!fs.existsSync(options.baselinePath)) {
      throw new GateInputError("Benchmark baseline not found. Run in bootstrap mode or capture one with --update-baseline.");
    }
    const baseline = validateBaseline(readJson(options.baselinePath, "benchmark baseline"));
    const current = buildSnapshot(collected, baseline.policy);
    const comparison = compareBenchmarks(baseline, current, options.projects);
    const candidate = buildSnapshot({ ...baseline.projects, ...collected }, baseline.policy);
    const baselineLabel = process.env.BENCHMARK_BASELINE_LABEL || path.relative(REPOSITORY_ROOT, options.baselinePath);
    writeJson(CANDIDATE_BASELINE_PATH, candidate);
    writeReports(
      renderMarkdown({ baseline, comparison, selectedProjects: options.projects, baselineLabel }),
      {
        schemaVersion: 1,
        status: comparison.passed ? "pass" : "fail",
        baseline: { label: baselineLabel, kind: baseline.kind, generatedFromCommit: baseline.generatedFromCommit },
        current,
        comparison,
      },
    );
    return comparison.passed ? 0 : 1;
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
