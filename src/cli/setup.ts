import { prepareWorkspace } from "./skills.ts";
import { paths } from "../paths.ts";
import type { Flags } from "./flags.ts";
export async function setupCmd(_flags: Flags): Promise<void> {
  prepareWorkspace();
  console.log(`Work Tracker skills installed in ${paths.workspace}`);
}
