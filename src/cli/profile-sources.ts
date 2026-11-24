import { notifyChange } from "../db/notify.ts";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "../profile/evidence.ts";
import { importProfileAssets } from "../profile/import.ts";
import { profileSourcesState } from "../profile/state.ts";
import type { Flags } from "./flags.ts";

const fail: (message: string) => never = (message) => {
  console.error(`error: ${message}`);
  return process.exit(1);
};

/** work-tracker profile sources | import [--force] */
export async function profileCmd(sub: string, flags: Flags): Promise<void> {
  if (sub === "sources") { console.log(JSON.stringify(profileSourcesState(), null, 2)); return; }
  if (sub !== "import") fail(`unknown profile subcommand: ${sub} (use sources or import)`);
  const config = sourcesConfig();
  if (!isFolder(config.profileDir)) fail("Choose an existing profile folder in Resume sources first.");
  const result = await importProfileAssets(config.profileDir, { force: flags.force === true });
  await notifyChange("profile_imports");
  console.log(JSON.stringify({ ...result, ...profileSourcesState(config) }, null, 2));
}
