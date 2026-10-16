"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const gate = require("./benchmark-gate.cjs");
const { summarizeAudit } = require("./ci/audit.cjs");

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
    kind: "bootstrap",
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
  it("validates baseline policy and metrics", () => {
    const valid = snapshot({ "suite > case > match": metrics(100) });
    assert.equal(gate.validateBaseline(valid), valid);
    assert.throws(() => gate.validateBaseline({ ...valid, schemaVersion: 2 }), /schemaVersion 1/);
    assert.throws(() => gate.validateBaseline({ ...valid, policy: { maxRegressionPercent: 100 } }), /lower than 100/);
    assert.throws(() => gate.validateBaseline(snapshot({})), /at least one benchmark/);
    assert.throws(() => gate.validateBaseline(snapshot({ x: { ...metrics(1), hz: 0 } })), /baseline hz/);
  });

  it("requires both layers when capturing a baseline", () => {
    assert.deepEqual(gate.parseArguments(["--projects", "frontend"]).projects, ["frontend"]);
    assert.deepEqual(gate.parseArguments(["--projects", ""]).projects, []);
    assert.throws(() => gate.parseArguments(["--bootstrap", "--projects", "backend"]), /both layers/);
    assert.throws(() => gate.parseArguments(["--projects", "web"]), /Unknown benchmark layer/);
  });

  it("identifies bootstrap snapshots with their runtime", () => {
    const value = gate.buildSnapshot({ backend: { benchmarks: {} } }, gate.DEFAULT_POLICY, { commit: "abc", kind: "bootstrap" });
    assert.equal(value.kind, "bootstrap");
    assert.equal(value.runtime.node, process.version);
    assert.deepEqual(Object.keys(value.projects), ["backend"]);
  });

  it("renders bootstrap and failing reports", () => {
    const baseline = snapshot({ "suite > case > match": metrics(100) });
    const comparison = gate.compareBenchmarks(baseline, snapshot({ "suite > case > match": metrics(50) }), ["backend"]);
    assert.match(gate.renderMarkdown({ baseline, comparison, selectedProjects: ["backend"], baselineLabel: "base" }), /\*\*FAIL\*\*/);
    assert.match(
      gate.renderMarkdown({ baseline, comparison: { ...comparison, failures: [] }, selectedProjects: [], baselineLabel: "base", bootstrap: true }),
      /Bootstrap reference captured/,
    );
  });
});

describe("dependency audit", () => {
  it("reads critical and high counts", () => {
    assert.deepEqual(summarizeAudit({ metadata: { vulnerabilities: { critical: 1, high: 2, low: 3 } } }), { critical: 1, high: 2 });
    assert.throws(() => summarizeAudit({ error: { summary: "offline" } }), /vulnerability counts/);
  });
});
