import { prepareWorkspace } from "./skills.ts";
import { paths } from "../paths.ts";
import { ensureMcpServers } from "../mcp/install/index.ts";
import type { Flags } from "./flags.ts";
export async function setupCmd(_flags: Flags): Promise<void> {
  prepareWorkspace();
  console.log(`Work Tracker skills installed in ${paths.workspace}`);
  for (const server of await ensureMcpServers()) console.log(`${server.name}: ${server.state} — ${server.message}`);
}
