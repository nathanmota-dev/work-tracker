"use strict";

// Local performance:check orchestration against a throwaway Git repository.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");
const { comparePerformance, parseArguments } = require("./performance-compare.cjs");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
};

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A repository whose `main` and `feat/change` differ in one file. */
function repository(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "performance-compare-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "--quiet", "--initial-branch=main");
  fs.writeFileSync(path.join(cwd, "code.txt"), "main\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "--quiet", "-m", "main");
  git(cwd, "switch", "--quiet", "-c", "feat/change");
  fs.writeFileSync(path.join(cwd, "code.txt"), "change\n");
  git(cwd, "commit", "--quiet", "-am", "change");
  return { cwd, main: git(cwd, "rev-parse", "main"), change: git(cwd, "rev-parse", "HEAD") };
}

function recorder(cwd, { failOn = null, captureStatus = 0 } = {}) {
  const calls = [];
  return {
    calls,
    cwd,
    log: () => {},
    runBenchmarks() {
      const code = fs.readFileSync(path.join(cwd, "code.txt"), "utf8").trim();
      calls.push(["benchmark", code]);
      return code === failOn ? 1 : 0;
    },
    capture(baselinePath) {
      calls.push(["capture", fs.readFileSync(path.join(cwd, "code.txt"), "utf8").trim()]);
      fs.writeFileSync(baselinePath, "base measurement");
      return captureStatus;
    },
    compare(baselinePath, label) {
      calls.push(["compare", fs.readFileSync(baselinePath, "utf8"), label, path.relative(cwd, baselinePath).startsWith("..")]);
      return 0;
    },
  };
}

describe("local performance comparison", () => {
  it("measures main, then the change, and compares the change with the main measurement", (t) => {
    const repo = repository(t);
    const run = recorder(repo.cwd);
    assert.equal(comparePerformance(run), 0);
    assert.deepEqual(run.calls, [
      ["benchmark", "main"],
      ["capture", "main"],
      ["benchmark", "change"],
      ["compare", "base measurement", `main@${repo.main.slice(0, 12)} (measured on this machine just before the change)`, true],
    ]);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "feat/change");
  });

  it("refuses a dirty working tree before switching", (t) => {
    const repo = repository(t);
    fs.writeFileSync(path.join(repo.cwd, "untracked.txt"), "x");
    const run = recorder(repo.cwd);
    assert.throws(() => comparePerformance(run), /clean working tree/);
    assert.deepEqual(run.calls, []);
    fs.rmSync(path.join(repo.cwd, "untracked.txt"));
    fs.writeFileSync(path.join(repo.cwd, "code.txt"), "edited\n");
    assert.throws(() => comparePerformance(run), /clean working tree/);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "feat/change");
  });

  it("restores the branch when main's benchmarks or capture fail", (t) => {
    const repo = repository(t);
    assert.throws(() => comparePerformance(recorder(repo.cwd, { failOn: "main" })), /Benchmarks failed on main/);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "feat/change");
    assert.throws(() => comparePerformance(recorder(repo.cwd, { captureStatus: 2 })), /Could not capture/);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "feat/change");
    assert.equal(git(repo.cwd, "status", "--porcelain"), "");
  });

  it("reports a failure of the change after returning to it", (t) => {
    const repo = repository(t);
    const run = recorder(repo.cwd, { failOn: "change" });
    assert.throws(() => comparePerformance(run), /failed on the current commit/);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "feat/change");
    assert.equal(run.calls.some(([kind]) => kind === "compare"), false);
  });

  it("returns to a detached commit and rejects unknown bases", (t) => {
    const repo = repository(t);
    git(repo.cwd, "switch", "--quiet", "--detach", repo.change);
    assert.equal(comparePerformance(recorder(repo.cwd)), 0);
    assert.equal(git(repo.cwd, "rev-parse", "HEAD"), repo.change);
    assert.equal(git(repo.cwd, "branch", "--show-current"), "");
    assert.throws(() => comparePerformance({ ...recorder(repo.cwd), base: "missing" }), /rev-parse/);
  });

  it("accepts another base ref", () => {
    assert.deepEqual(parseArguments([]), { base: "main" });
    assert.deepEqual(parseArguments(["--base", "origin/main"]), { base: "origin/main" });
    assert.throws(() => parseArguments(["--baseline", "x"]), /Unknown argument/);
  });
});
