#!/usr/bin/env node
import { runCli } from "./run.ts";
import { closeDb } from "../db/index.ts";
import { closeMcp } from "../mcp/linkedin.ts";

async function main(): Promise<void> {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Work Tracker CLI requires Node.js 24 or newer");
  await runCli(process.argv.slice(2));
}

main().catch(async (err) => {
  console.error(err);
  await closeMcp();
  closeDb();
  process.exitCode = 1;
});
