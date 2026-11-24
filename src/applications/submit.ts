import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { startTracking, transition } from "./journey-store.ts";
import { application } from "./records.ts";
import { trackedChanges } from "./archive.ts";
import { id, type Body } from "./validation.ts";
import type { TrackedApplication } from "./types.ts";

/**
 * The candidate confirms they submitted this application in the portal, from the
 * list: it is marked submitted and enters the board in one step. It does not
 * depend on a portal run, so a fill that stopped without a result cannot block
 * it. Repeating it changes nothing. Must run inside the caller's transaction.
 */
export function submit(d: Database, body: Body): { value: TrackedApplication; changed: string[] } {
  const target = id(body.id);
  const submitted = transition(d, target, "submit", "api").changed;
  const tracked = startTracking(d, target);
  d.query("UPDATE application_documents SET submitted_at = COALESCE(submitted_at, ?) WHERE application_id = ?").run(now(), target);
  return { value: application(d, target), changed: submitted || tracked ? [...trackedChanges] : [] };
}
