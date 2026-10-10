import { detectPortal } from "../adapters/registry.ts";
import { reqStr, type Flags } from "./flags.ts";

/**
 * work-tracker detect-portal --url <application-url>
 *
 * Identifies which ATS an opportunity uses and returns the adapter's known
 * stable field selectors, widget types, and quirk
 * notes, so the skill can fill known fields reliably before falling back to the
 * generic `work-tracker match` flow for per-posting custom questions.
 *
 * Output:
 *   { "portal": "greenhouse",
 *     "fields": [{ "key": "email", "selectors": ["#email"], "widget": "text" }],
 *     "notes":  ["..."] }
 */
export async function detectPortalCmd(flags: Flags): Promise<void> {
  const url = reqStr(flags, "url");
  const adapter = detectPortal(url);
  console.log(
    JSON.stringify(
      { portal: adapter.portal, fields: adapter.fields, notes: adapter.notes },
      null,
      2,
    ),
  );
}
