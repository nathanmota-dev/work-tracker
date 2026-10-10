/**
 * ACP provider registry. Each provider knows how to spawn an agent that
 * speaks the Agent Client Protocol over stdio.
 */

import { createHash } from "node:crypto";
import { loadConfig, paths } from "../paths.ts";
import { agentEnvironment, prepareWorkspace } from "../cli/skills.ts";

export interface AcpProviderCommand {
  cmd: string[];
  env?: Record<string, string>;
}

/**
 * @property models Available model IDs for this provider.
 * @property defaultModel Default model; undefined means use the provider default.
 * @property command Command and arguments to spawn the agent in ACP mode.
 * @property bin Binary name expected on PATH, used for availability hints.
 */
export interface AcpProvider {
  id: string;
  displayName: string;
  models: string[];
  defaultModel?: string;
  command: (cwd: string, model?: string) => AcpProviderCommand;
  bin: string;
}

export const PROVIDERS: Record<string, AcpProvider> = {
  opencode: {
    id: "opencode",
    displayName: "opencode",
    bin: "opencode",
    models: [],
    defaultModel: undefined,
    command: (cwd, model) => {
      const env = model ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model }) } : undefined;
      return { cmd: ["opencode", "acp", "--cwd", cwd], env };
    },
  },
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    bin: "claude",
    // Fallback only. At runtime models are discovered live from the adapter.
    // These stable aliases are used when that probe
    // fails (adapter missing, not logged in, timeout); they're what
    // ANTHROPIC_MODEL accepts and always resolve to the current generation.
    models: ["opus", "sonnet", "haiku"],
    defaultModel: undefined,
    // Zed's ACP adapter wraps the Claude Code CLI.
    // Model is passed via ANTHROPIC_MODEL env rather than a CLI flag.
    command: (cwd, model) => {
      // The adapter refuses to start when it sees CLAUDECODE set (its
      // nested-session guard). When the dashboard itself is launched from
      // inside a Claude Code session that var is inherited, which would
      // otherwise make every claude-code run fail at session/new. Neutralize
      // the guard for the spawned child; this is the adapter's documented
      // escape hatch ("unset the CLAUDECODE environment variable").
      const env: Record<string, string> = { CLAUDECODE: "" };
      if (model) env.ANTHROPIC_MODEL = model;
      return { cmd: ["claude-code-acp"], env };
    },
  },
};

export function getProvider(id: string | undefined): AcpProvider {
  const key = id ?? "opencode";
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Unknown ACP provider: ${key}`);
  const custom = loadConfig().acp?.[key as "opencode" | "claude-code"];
  return {
    ...provider,
    command: (cwd, model) => {
      const defaults = provider.command(cwd, model);
      const env = { ...custom?.env, ...defaults.env };
      if (key === "opencode" && model) {
        const content = custom?.env?.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT;
        const config: unknown = content ? JSON.parse(content) : {};
        if (!config || typeof config !== "object" || Array.isArray(config)) {
          throw new Error("OPENCODE_CONFIG_CONTENT must be a JSON object");
        }
        // Selecting a model must preserve other inline provider settings.
        env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, model });
      }
      return {
        cmd: custom ? [custom.command, ...(custom.args ?? [])] : defaults.cmd,
        env,
      };
    },
  };
}
const MODELS_TTL_MS = 5 * 60 * 1000;
const MODELS_TIMEOUT_MS = 15000;
const cache = new Map<string, { key: string; at: number; result: Promise<string[]> }>();
export async function listProviderModels(id: string): Promise<string[]> {
  const provider = getProvider(id);
  const command = provider.command(paths.workspace);
  // Changes to the executable, arguments or session environment invalidate the cache.
  const key = createHash("sha256").update(JSON.stringify({
    cwd: paths.workspace, cmd: command.cmd, env: { ...agentEnvironment(), ...command.env },
  })).digest("hex");
  const old = cache.get(id);
  if (old?.key === key && Date.now() - old.at < MODELS_TTL_MS) return [...await old.result];
  const result = probeProviderModels(id, command).then(
    models => models.length ? models : [...provider.models],
    () => [...provider.models],
  );
  cache.set(id, { key, at: Date.now(), result });
  return [...await result];
}

/** Enumerate models through the same ACP command and private workspace as skill runs. */
async function probeProviderModels(id: string, command: AcpProviderCommand): Promise<string[]> {
  prepareWorkspace();
  const { AcpClient } = await import("./client.ts");
  const client = new AcpClient(id, paths.workspace);
  const timer = setTimeout(() => client.stop(), MODELS_TIMEOUT_MS);
  try {
    // Model discovery needs no tools or prompt; avoid starting the session's MCPs.
    await client.start({ command, mcpServers: [] });
    return client.availableModels;
  } finally {
    clearTimeout(timer);
    client.stop();
  }
}
