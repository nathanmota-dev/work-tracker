import { currentSourceVersion } from "../variants/service.ts";
import { listVariants } from "../variants/store.ts";
import type { Flags } from "./flags.ts";

const fail: (message: string) => never = (message) => {
  console.error(`error: ${message}`);
  return process.exit(1);
};

/** work-tracker variant list [--archived]: saved resumes as JSON, without their agent events. */
export function variantCmd(sub: string, flags: Flags): void {
  if (sub !== "list") fail(`unknown variant subcommand: ${sub} (use list)`);
  const variants = listVariants({ includeArchived: flags.archived === true, currentVersion: currentSourceVersion() });
  console.log(JSON.stringify(variants.map(({ events: _events, ...variant }) => variant), null, 2));
}
