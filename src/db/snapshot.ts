import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "./sqlite.ts";

/**
 * Write a transactionally consistent copy of an open database to `destination`.
 *
 * Uses `VACUUM INTO`, which reads through the connection and therefore includes
 * committed pages still in the WAL file; the copy is a single self-contained file
 * with no -wal/-shm companions. The copy is checked with `quick_check` before it
 * is moved into place, so a returned path always names a readable database.
 * Must not be called inside a transaction. Reused by workspace backup.
 */
export function snapshotDatabase(d: Database, destination: string): string {
  if (existsSync(destination)) throw new Error(`Snapshot destination already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const partial = `${destination}.partial`;
  rmSync(partial, { force: true });
  try {
    d.query("VACUUM INTO ?").run(partial);
    chmodSync(partial, 0o600);
    verifySnapshot(partial);
    renameSync(partial, destination);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  return destination;
}

/** Throw unless SQLite's `quick_check` reports the open database as intact. */
export function assertIntact(d: Database, label: string): void {
  const result = d.query("PRAGMA quick_check").get() as { quick_check: string } | undefined;
  if (result?.quick_check !== "ok") throw new Error(`${label}: ${result?.quick_check ?? "no result"}`);
}

function verifySnapshot(path: string): void {
  const copy = new Database(path);
  try { assertIntact(copy, "Snapshot failed integrity check"); } finally { copy.close(); }
}
