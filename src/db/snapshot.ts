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

function verifySnapshot(path: string): void {
  const copy = new Database(path);
  try {
    const result = copy.query("PRAGMA quick_check").get() as { quick_check: string } | undefined;
    if (result?.quick_check !== "ok") throw new Error(`Snapshot failed integrity check: ${result?.quick_check ?? "no result"}`);
  } finally { copy.close(); }
}
