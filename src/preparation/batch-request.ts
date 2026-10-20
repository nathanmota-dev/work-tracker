import type { Database } from "../db/sqlite.ts";
import { PreparationError } from "./sources.ts";

/** Keep the original request after queue progress and later item additions. */
export function batchRequest(d: Database, key: unknown, fingerprint: string): string | undefined {
  if (key === undefined) return;
  if (typeof key !== "string" || !/^[\w-]{1,128}$/.test(key)) throw new PreparationError("Invalid batch request ID.");
  const row = d.query("SELECT batch_id, fingerprint FROM preparation_batch_requests WHERE request_id = ?").get(key) as { batch_id: string; fingerprint: string } | undefined;
  if (row && row.fingerprint !== fingerprint) throw new PreparationError("This batch request ID was already used for a different selection or configuration.", 409);
  return row?.batch_id;
}
export function recordBatchRequest(d: Database, key: unknown, batchId: string, fingerprint: string): void {
  if (typeof key === "string") d.query("INSERT INTO preparation_batch_requests (request_id, batch_id, fingerprint) VALUES (?, ?, ?)").run(key, batchId, fingerprint);
}
