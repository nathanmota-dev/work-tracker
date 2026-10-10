import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig, paths } from "../paths.ts";
import { AcpClient } from "./client.ts";
import { prepareWorkspace } from "../cli/skills.ts";
import { deferred } from "../test/doubles.ts";
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(),
  paths: { workspace: "/private/workspace" },
}));
vi.mock("../cli/skills.ts", () => ({
  agentEnvironment: () => ({ PRIVATE: "yes" }),
  prepareWorkspace: vi.fn(),
}));
vi.mock("./client.ts", () => ({ AcpClient: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.mocked(loadConfig).mockReturnValue({});
});
test("default and custom commands preserve settings while selecting models", async () => {
  const { getProvider } = await import("./providers.ts");
  vi.stubEnv(
    "OPENCODE_CONFIG_CONTENT",
    '{"provider":{"fixture":{}},"model":"old"}',
  );
  expect(getProvider(undefined).command("/cwd", "new")).toEqual({
    cmd: ["opencode", "acp", "--cwd", "/cwd"],
    env: {
      OPENCODE_CONFIG_CONTENT: '{"provider":{"fixture":{}},"model":"new"}',
    },
  });
  expect(getProvider("claude-code").command("/cwd", "sonnet")).toEqual({
    cmd: ["claude-code-acp"],
    env: { CLAUDECODE: "", ANTHROPIC_MODEL: "sonnet" },
  });
  vi.mocked(loadConfig).mockReturnValue({
    acp: {
      opencode: {
        command: "custom",
        args: ["acp"],
        env: {
          TOKEN: "fixture",
          OPENCODE_CONFIG_CONTENT: '{"model":"configured"}',
        },
      },
      "claude-code": {
        command: "adapter",
        env: { CLAUDECODE: "parent", ANTHROPIC_MODEL: "old" },
      },
    },
  });
  expect(getProvider("opencode").command("/cwd")).toEqual({
    cmd: ["custom", "acp"],
    env: {
      TOKEN: "fixture",
      OPENCODE_CONFIG_CONTENT: '{"model":"configured"}',
    },
  });
  expect(getProvider("opencode").command("/cwd", "new").env).toEqual({
    TOKEN: "fixture",
    OPENCODE_CONFIG_CONTENT: '{"model":"new"}',
  });
  expect(getProvider("claude-code").command("/cwd", "haiku")).toEqual({
    cmd: ["adapter"],
    env: { CLAUDECODE: "", ANTHROPIC_MODEL: "haiku" },
  });
  expect(() => getProvider("missing")).toThrow("Unknown ACP provider");
});
test.each(["opencode", "claude-code"] as const)(
  "%s retains configured model settings when no model selection is supplied",
  async (id) => {
    const inline = '{"model":"configured"}';
    vi.mocked(loadConfig).mockReturnValue({
      acp: {
        [id]: {
          command: "custom",
          args: ["acp"],
          env: {
            OPENCODE_CONFIG_CONTENT: inline,
            ANTHROPIC_MODEL: "configured",
          },
        },
      },
    });
    const { getProvider } = await import("./providers.ts");
    const command = getProvider(id).command("/cwd");
    expect(command.cmd).toEqual(["custom", "acp"]);
    expect(command.env).toMatchObject({
      OPENCODE_CONFIG_CONTENT: inline,
      ANTHROPIC_MODEL: "configured",
    });
  },
);
test.each(["[]", "null", '"string"', "{"])(
  "rejects invalid inline OpenCode configuration %s",
  async (value) => {
    vi.stubEnv("OPENCODE_CONFIG_CONTENT", value);
    const { getProvider } = await import("./providers.ts");
    expect(() => getProvider("opencode").command("/cwd", "model")).toThrow();
  },
);
test("model discovery shares concurrent probes, protects cached arrays and refreshes on TTL or configuration change", async () => {
  const pending = deferred();
  const start = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined),
    stop = vi.fn();
  vi.mocked(AcpClient).mockImplementation(function () {
    return {
      start,
      stop,
      availableModels: ["fixture/a", "fixture/b"],
    } as unknown as AcpClient;
  });
  const { listProviderModels } = await import("./providers.ts");
  const a = listProviderModels("opencode"),
    b = listProviderModels("opencode");
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  pending.resolve();
  expect(await Promise.all([a, b])).toEqual([
    ["fixture/a", "fixture/b"],
    ["fixture/a", "fixture/b"],
  ]);
  expect(start).toHaveBeenCalledWith({
    command: { cmd: ["opencode", "acp", "--cwd", paths.workspace], env: {} },
    mcpServers: [],
  });
  const result = await listProviderModels("opencode");
  result.push("caller-mutates");
  expect(await listProviderModels("opencode")).toEqual([
    "fixture/a",
    "fixture/b",
  ]);
  await vi.advanceTimersByTimeAsync(300000);
  await listProviderModels("opencode");
  expect(start).toHaveBeenCalledTimes(2);
  vi.mocked(loadConfig).mockReturnValue({
    acp: { opencode: { command: "changed", env: { KEY: "new" } } },
  });
  await listProviderModels("opencode");
  expect(start).toHaveBeenCalledTimes(3);
  expect(stop).toHaveBeenCalledTimes(3);
  expect(prepareWorkspace).toHaveBeenCalledTimes(3);
});
test.each(["opencode", "claude-code"])(
  "%s uses fallback after a failure or empty model list",
  async (id) => {
    const start = vi.fn().mockRejectedValue(new Error("missing")),
      stop = vi.fn();
    vi.mocked(AcpClient).mockImplementation(function () {
      return { start, stop, availableModels: [] } as unknown as AcpClient;
    });
    const { listProviderModels } = await import("./providers.ts");
    const fallback = id === "opencode" ? [] : ["opus", "sonnet", "haiku"];
    expect(await listProviderModels(id)).toEqual(fallback);
    expect(stop).toHaveBeenCalledOnce();
    start.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(300000);
    expect(await listProviderModels(id)).toEqual(fallback);
  },
);
test("stalled discovery stops the client at fifteen seconds and clears its timer", async () => {
  const pending = deferred();
  const stop = vi.fn(() => pending.reject(new Error("stopped")));
  vi.mocked(AcpClient).mockImplementation(function () {
    return { start: () => pending.promise, stop } as unknown as AcpClient;
  });
  const { listProviderModels } = await import("./providers.ts");
  const result = listProviderModels("claude-code");
  await vi.advanceTimersByTimeAsync(14999);
  expect(stop).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual(["opus", "sonnet", "haiku"]);
  expect(vi.getTimerCount()).toBe(0);
});
