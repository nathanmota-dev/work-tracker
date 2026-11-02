"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const gate = require("./benchmark-gate.cjs");
const { summarizeAudit } = require("./ci/audit.cjs");
const { REPOSITORY_ROOT, stampArtifact, writeJson } = require("./ci/common.cjs");

function task(name, hz, overrides = {}) {
  return {
    name,
    throughput: { mean: hz, rme: 1.5, samplesCount: 100 },
    latency: { mean: 1000 / hz, p50: 1000 / hz },
    ...overrides,
  };
}
function report(tasks, overrides = {}) {
  return {
    success: true,
    numFailedTests: 0,
    testResults: [{
      assertionResults: [{ status: "passed", fullName: "suite > case", benchmarks: [{ name: "suite > case", tasks }] }],
    }],
    ...overrides,
  };
}
function metrics(hz) {
  return { hz, mean: 1000 / hz, median: 1000 / hz, rme: 1, sampleCount: 100 };
}
function snapshot(backend, frontend = { "suite > case > render": metrics(100) }) {
  return {
    schemaVersion: 1,
    kind: "measurement",
    policy: { maxRegressionPercent: 20 },
    projects: { backend: { benchmarks: backend }, frontend: { benchmarks: frontend } },
  };
}

describe("Vitest 5 JSON parsing", () => {
  it("extracts bench fixture tasks keyed by test and task name", () => {
    const parsed = gate.extractProjectMetrics("backend", report([task("match", 50)]));
    assert.deepEqual(Object.keys(parsed.benchmarks), ["suite > case > match"]);
    assert.equal(parsed.benchmarks["suite > case > match"].hz, 50);
    assert.equal(parsed.benchmarks["suite > case > match"].median, 20);
  });

  it("rejects failed checks, missing benchmarks and invalid statistics", () => {
    assert.throws(() => gate.extractProjectMetrics("backend", report([task("a", 1)], { success: false })), /failed/);
    const failedAssertion = report([task("a", 1)]);
    failedAssertion.testResults[0].assertionResults[0].status = "failed";
    assert.throws(() => gate.extractProjectMetrics("backend", { ...failedAssertion, success: true }), /did not pass/);
    assert.throws(() => gate.extractProjectMetrics("backend", report([])), /unnamed or empty/);
    assert.throws(() => gate.extractProjectMetrics("backend", report([task("a", Number.NaN)])), /throughput/);
    assert.throws(() => gate.extractProjectMetrics("backend", report([task("a", 1), task("a", 2)])), /duplicate/);
    assert.throws(() => gate.extractProjectMetrics("backend", { testResults: [] }), /must contain test results/);
    const missing = report([task("a", 1)]);
    missing.testResults[0].assertionResults[0].benchmarks = [];
    assert.throws(() => gate.extractProjectMetrics("backend", missing), /did not record a benchmark/);
  });
});

describe("throughput comparison", () => {
  const baseline = snapshot({ "suite > case > match": metrics(100) });

  it("passes at exactly the 20% limit and blocks larger losses", () => {
    assert.equal(gate.compareBenchmarks(baseline, snapshot({ "suite > case > match": metrics(80) }), ["backend"]).passed, true);
    const result = gate.compareBenchmarks(baseline, snapshot({ "suite > case > match": metrics(79) }), ["backend"]);
    assert.equal(result.passed, false);
    assert.match(result.failures[0], /lost 21.00% throughput/);
  });

  it("blocks removed scenarios and warns about new ones", () => {
    const result = gate.compareBenchmarks(baseline, snapshot({ "suite > case > other": metrics(100) }), ["backend"]);
    assert.equal(result.passed, false);
    assert.match(result.failures[0], /removed or did not run/);
    assert.match(result.warnings[0], /is new/);
  });

  it("only evaluates selected layers", () => {
    const result = gate.compareBenchmarks(baseline, snapshot({}, {}), ["frontend"]);
    assert.equal(result.passed, false);
    assert.equal(result.results.every((item) => item.project === "frontend"), true);
    assert.equal(gate.compareBenchmarks(baseline, snapshot({}, {}), []).passed, true);
  });
});

describe("baseline and arguments", () => {
  it("validates baseline policy and the metrics of the selected layers", () => {
    const valid = snapshot({ "suite > case > match": metrics(100) });
    assert.equal(gate.validateBaseline(valid), valid);
    assert.throws(() => gate.validateBaseline({ ...valid, schemaVersion: 2 }), /schemaVersion 1/);
    assert.throws(() => gate.validateBaseline({ ...valid, policy: { maxRegressionPercent: 100 } }), /lower than 100/);
    assert.throws(() => gate.validateBaseline(snapshot({})), /at least one benchmark/);
    assert.throws(() => gate.validateBaseline(snapshot({ x: { ...metrics(1), hz: 0 } })), /baseline hz/);
    const frontendOnly = { ...valid, projects: { frontend: valid.projects.frontend } };
    assert.equal(gate.validateBaseline(frontendOnly, ["frontend"]), frontendOnly);
    assert.throws(() => gate.validateBaseline(frontendOnly, ["backend"]), /no backend measurement/);
  });

  it("requires a base measurement and keeps captures outside the repository", () => {
    const outside = path.join(os.tmpdir(), "base.json");
    assert.deepEqual(gate.parseArguments(["--projects", "frontend", "--baseline", outside], {}).projects, ["frontend"]);
    assert.deepEqual(gate.parseArguments(["--projects", ""], {}).projects, []);
    assert.equal(gate.parseArguments([], { BENCHMARK_BASELINE_PATH: outside }).baselinePath, outside);
    assert.equal(gate.parseArguments(["--capture", outside, "--projects", "backend"], {}).capturePath, outside);
    assert.equal(gate.parseArguments(["--baseline", outside, "--label", "main@abc"], {}).label, "main@abc");
    assert.throws(() => gate.parseArguments([], {}), /base measurement from this machine is required/);
    assert.throws(() => gate.parseArguments(["--capture", "scripts/benchmark-baseline.json"], {}), /outside the repository/);
    assert.throws(() => gate.parseArguments(["--capture", outside, "--baseline", outside], {}), /either --capture or --baseline/);
    assert.throws(() => gate.parseArguments(["--bootstrap"], {}), /Unknown argument/);
    assert.throws(() => gate.parseArguments(["--update-baseline"], {}), /Unknown argument/);
    assert.throws(() => gate.parseArguments(["--projects", "web", "--baseline", outside], {}), /Unknown benchmark layer/);
  });

  it("identifies measurements with their machine and run", () => {
    const value = gate.buildSnapshot({ backend: { benchmarks: {} } }, gate.DEFAULT_POLICY, { commit: "abc" });
    assert.equal(value.kind, "measurement");
    assert.equal(value.runtime.node, process.version);
    assert.match(value.runtime.machine, /^[a-f0-9]{16}$/);
    assert.deepEqual(Object.keys(value.projects), ["backend"]);
  });

  it("only compares measurements taken on the same machine in the same run", () => {
    const current = gate.buildSnapshot({}, gate.DEFAULT_POLICY, { commit: "head" });
    const base = gate.buildSnapshot({}, gate.DEFAULT_POLICY, { commit: "base" });
    assert.doesNotThrow(() => gate.assertSameEnvironment(base, current));
    for (const field of ["machine", "node", "runId", "runAttempt"]) {
      const foreign = { ...base, runtime: { ...base.runtime, [field]: "other" } };
      assert.throws(() => gate.assertSameEnvironment(foreign, current), new RegExp(`another environment \\(${field}:`));
    }
    const committed = { ...base, runtime: { node: process.version, runner: "local" } };
    assert.throws(() => gate.assertSameEnvironment(committed, current), /machine: expected [a-f0-9]+, found none/);
  });

  it("renders both measurements, failures and new scenarios", () => {
    const baseline = snapshot({ "suite > case > match": metrics(100) });
    const current = gate.buildSnapshot({ backend: { benchmarks: { "suite > case > match": metrics(50), "suite > case > new": metrics(10) } } }, gate.DEFAULT_POLICY, { commit: "head123" });
    const comparison = gate.compareBenchmarks(baseline, current, ["backend"]);
    const markdown = gate.renderMarkdown({ baseline, current, comparison, selectedProjects: ["backend"], baselineLabel: "main@abc (measured on this runner)" });
    assert.match(markdown, /\*\*FAIL\*\*/);
    assert.match(markdown, /Baseline: main&#64;abc \(measured on this runner\) · change: `head123`/);
    assert.match(markdown, /\| 100 \| 50 \| -50\.00% \|/);
    assert.match(markdown, /## Warnings\n\n- backend\/suite &gt; case &gt; new is new/);
    assert.doesNotMatch(markdown, /[Bb]ootstrap/);
  });
});

describe("command line", () => {
  it("captures the base outside the repository and compares the change with it", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "benchmark-gate-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const reportsRoot = path.join(REPOSITORY_ROOT, "reports", "benchmarks");
    const reportPath = path.join(reportsRoot, "backend.json");
    const reportBackup = fs.existsSync(reportPath) ? fs.readFileSync(reportPath) : null;
    const provenanceBackup = fs.existsSync(`${reportPath}.provenance.json`) ? fs.readFileSync(`${reportPath}.provenance.json`) : null;
    t.after(() => {
      for (const [file, contents] of [[reportPath, reportBackup], [`${reportPath}.provenance.json`, provenanceBackup]]) {
        if (contents) fs.writeFileSync(file, contents);
        else fs.rmSync(file, { force: true });
      }
    });
    const writeReport = (hz) => {
      writeJson(reportPath, report([task("match", hz)]));
      stampArtifact(reportPath, { layer: "backend", kind: "benchmark" });
    };
    const quiet = t.mock.method(process.stdout, "write", () => true);
    t.mock.method(process.stderr, "write", () => true);
    const basePath = path.join(directory, "base.json");
    writeReport(100);
    assert.equal(gate.runCli(["--capture", basePath, "--projects", "backend"]), 0);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(basePath, "utf8")).projects), ["backend"]);
    writeReport(90);
    assert.equal(gate.runCli(["--baseline", basePath, "--projects", "backend"]), 0);
    writeReport(70);
    assert.equal(gate.runCli(["--baseline", basePath, "--projects", "backend"]), 1);
    assert.equal(gate.runCli(["--baseline", basePath, "--projects", "frontend"]), 2);
    assert.equal(gate.runCli(["--projects", ""]), 0);
    quiet.mock.restore();
  });
});

describe("dependency audit", () => {
  it("reads critical and high counts", () => {
    assert.deepEqual(summarizeAudit({ metadata: { vulnerabilities: { critical: 1, high: 2, low: 3 } } }), { critical: 1, high: 2 });
    assert.throws(() => summarizeAudit({ error: { summary: "offline" } }), /vulnerability counts/);
  });
});
