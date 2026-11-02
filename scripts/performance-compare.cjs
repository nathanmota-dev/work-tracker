#!/usr/bin/env node
"use strict";

// Local `npm run performance:check`: measures the base (main by default) and the
// current commit back to back on this machine and compares them, so the result
// never depends on numbers recorded on other hardware. The gate is loaded before
// switching, so the branch's gate captures the base and judges the change.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const gate = require("./benchmark-gate.cjs");
const { GateInputError, REPOSITORY_ROOT } = require("./ci/common.cjs");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) throw new GateInputError(`Could not run git: ${result.error.message}`);
  if (result.status !== 0) {
    throw new GateInputError(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

/** The branch to come back to, or the commit when HEAD is detached. */
function currentPosition(cwd) {
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd, encoding: "utf8" });
  if (branch.status === 0 && branch.stdout.trim()) return { branch: branch.stdout.trim() };
  return { commit: git(cwd, ["rev-parse", "HEAD"]) };
}

function restore(cwd, position) {
  git(cwd, position.branch ? ["switch", "--quiet", position.branch] : ["switch", "--quiet", "--detach", position.commit]);
}

function npmBenchmarks(cwd) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "benchmark"], { cwd, stdio: "inherit" });
  if (result.error) throw new GateInputError(`Could not run npm run benchmark: ${result.error.message}`);
  return result.status ?? 1;
}

/**
 * Measures `base`, records it outside the repository, returns to the starting
 * branch (also after a failure) and compares the current commit with it.
 */
function comparePerformance({
  cwd = REPOSITORY_ROOT,
  base = "main",
  runBenchmarks = () => npmBenchmarks(cwd),
  capture = (baselinePath) => gate.runCli(["--capture", baselinePath]),
  compare = (baselinePath, label) => gate.runCli(["--baseline", baselinePath, "--label", label]),
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  if (git(cwd, ["status", "--porcelain", "--untracked-files=all"])) {
    throw new GateInputError("performance:check requires a clean working tree; commit the change first.");
  }
  const baseCommit = git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  const position = currentPosition(cwd);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "work-tracker-benchmark-"));
  const baselinePath = path.join(directory, "base-benchmarks.json");
  const label = `${base}@${baseCommit.slice(0, 12)} (measured on this machine just before the change)`;
  try {
    log(`Measuring ${base} (${baseCommit.slice(0, 12)})...`);
    git(cwd, ["switch", "--quiet", "--detach", baseCommit]);
    try {
      if (runBenchmarks() !== 0) throw new GateInputError(`Benchmarks failed on ${base}.`);
      if (capture(baselinePath) !== 0) throw new GateInputError(`Could not capture the ${base} measurement.`);
    } finally {
      restore(cwd, position);
    }
    log(`Measuring ${position.branch ?? position.commit.slice(0, 12)}...`);
    if (runBenchmarks() !== 0) throw new GateInputError("Benchmarks failed on the current commit.");
    return compare(baselinePath, label);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const options = { base: "main" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--base" && args[index + 1]) {
      options.base = args[++index];
    } else {
      throw new GateInputError(`Unknown argument: ${args[index]}. Usage: performance-compare.cjs [--base <ref>]`);
    }
  }
  return options;
}

function main(args = process.argv.slice(2)) {
  // Ctrl+C reaches the benchmark child too; keep this process alive so it restores the branch.
  let interrupted = false;
  const onSignal = () => { interrupted = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const status = comparePerformance(parseArguments(args));
    return interrupted ? 130 : status;
  } catch (error) {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    return interrupted ? 130 : 2;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

module.exports = { comparePerformance, parseArguments };

if (require.main === module) process.exitCode = main();
