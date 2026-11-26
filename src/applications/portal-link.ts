import { now } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { journeyRecord } from "./journey-store.ts";
import type { PortalLinkResult } from "./types.ts";
import { ApplicationBoardError, fields, id, type Body } from "./validation.ts";

/**
 * Save the employer's form link while the application is being prepared. It is
 * not on the board before its submission, so the board's `update` cannot reach it.
 */
export function savePortalLink(d: Database, body: Body): PortalLinkResult {
  const record = journeyRecord(d, id(body.id));
  if (record.submission_status === "submitted")
    throw new ApplicationBoardError("This application was already submitted. Edit its link on the board.", 409);
  const url = fields({ external_url: body.external_url }, true).external_url!;
  d.query("UPDATE applications SET external_url = ?, updated_at = ? WHERE id = ?").run(url, now(), record.id);
  return { id: record.id, external_url: url };
}
