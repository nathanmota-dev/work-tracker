import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { AcpClient } from "./client.ts";
import { spawnOwned, stopOwned } from "./process.ts";
import { getProvider } from "./providers.ts";
import { processDouble } from "../test/doubles.ts";
vi.mock("./process.ts", () => ({ spawnOwned: vi.fn(), stopOwned: vi.fn() }));
vi.mock("./providers.ts", () => ({
  getProvider: vi.fn(() => ({
    command: vi.fn(() => ({ cmd: ["agent", "acp"], env: { MODEL: "chosen" } })),
  })),
}));
vi.mock("../cli/skills.ts", () => ({
  agentEnvironment: () => ({ PRIVATE: "yes" }),
}));
vi.mock("../mcp/config.ts", () => ({
  acpMcpServers: () => [{ name: "private-mcp" }],
}));
let p: ReturnType<typeof processDouble>;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const deliver = (msg: unknown) =>
  p.child.stdout.emit("data", JSON.stringify(msg) + "\n");
const writes = () =>
  p.child.stdin.write.mock.calls.map(([line]) => JSON.parse(String(line)));
async function started(events = {}, models: unknown = []) {
  const client = new AcpClient("opencode", "/private", events, "model", 50);
  const start = client.start();
  deliver({ id: 1, result: {} });
  await flush();
  deliver({
    id: 2,
    result: { sessionId: "session-1", models: { availableModels: models } },
  });
  await start;
  return client;
}
beforeEach(() => {
  vi.useFakeTimers();
  p = processDouble();
  vi.mocked(spawnOwned).mockReturnValue(p.asChild);
});
test("handshake advertises fs, passes workspace and MCPs and filters model advertisements", async () => {
  const client = await started({}, [
    { modelId: "default" },
    { modelId: "a" },
    { modelId: "a" },
    null,
    {},
    { modelId: 3 },
    { modelId: " " },
    { modelId: "b" },
  ]);
  expect(spawnOwned).toHaveBeenCalledWith("agent", ["acp"], {
    cwd: "/private",
    env: { PRIVATE: "yes", MODEL: "chosen" },
  });
  expect(getProvider).toHaveBeenCalledWith("opencode");
  expect(writes().slice(0, 2)).toEqual([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: "/private", mcpServers: [{ name: "private-mcp" }] },
    },
  ]);
  expect(client.availableModels).toEqual(["a", "b"]);
  client.availableModels.push("mutation");
  expect(client.availableModels).toEqual(["a", "b"]);
  client.stop();
  expect(vi.getTimerCount()).toBe(0);
});
test("explicit probe command omits MCPs and handles fragmented messages and log lines", async () => {
  const onLog = vi.fn();
  const client = new AcpClient("opencode", "/private", { onLog });
  const start = client.start({ command: { cmd: ["custom"] }, mcpServers: [] });
  p.child.stdout.emit("data", 'plain log\n\n{"id":1,"res');
  p.child.stdout.emit("data", 'ult":{}}\n');
  await flush();
  expect(writes()[1].params.mcpServers).toEqual([]);
  deliver({ id: 2, result: { sessionId: "probe" } });
  await start;
  p.child.stderr.emit("data", Buffer.from("stderr"));
  expect(onLog.mock.calls).toEqual([["plain log"], ["stderr"]]);
  client.stop();
  await expect(client.prompt("x")).rejects.toThrow("no active");
  await expect(client.cancel()).resolves.toBeUndefined();
});
test("prompt updates, out-of-order concurrent results, RPC errors and cancellation", async () => {
  const onUpdate = vi.fn();
  const client = await started({ onUpdate });
  const a = client.prompt("first"),
    b = client.prompt("second");
  const rejected = expect(b).rejects.toThrow("denied");
  deliver({ method: "session/update", params: { text: "chunk" } });
  deliver({ id: 4, error: { code: 1, message: "denied" } });
  deliver({ id: 99, result: {} });
  deliver({ id: 3, result: { stopReason: "end_turn" } });
  expect(await a).toEqual({ stopReason: "end_turn" });
  await rejected;
  expect(onUpdate).toHaveBeenCalledWith({ text: "chunk" });
  expect(writes()[2]).toMatchObject({
    method: "session/prompt",
    params: {
      sessionId: "session-1",
      prompt: [{ type: "text", text: "first" }],
    },
  });
  const waiting = client.prompt("waiting");
  const stopped = expect(waiting).rejects.toThrow("stopped");
  await client.cancel();
  expect(writes().at(-1)).toEqual({
    jsonrpc: "2.0",
    method: "session/cancel",
    params: { sessionId: "session-1" },
  });
  client.stop();
  await stopped;
});
test("agent callbacks reply to reads, writes, permissions and unknown requests without replying to notifications", async () => {
  const client = await started();
  vi.mocked(readFileSync).mockReturnValue("contents");
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  deliver({
    id: "read",
    method: "fs/read_text_file",
    params: { path: "/fixture" },
  });
  deliver({
    id: "write",
    method: "fs/write_text_file",
    params: { path: "/fixture", content: "new" },
  });
  deliver({
    id: "permission",
    method: "session/request_permission",
    params: {
      options: [
        { kind: "reject", optionId: "no" },
        { kind: "allow_once", optionId: "yes" },
      ],
    },
  });
  deliver({ id: "unknown", method: "future/call" });
  deliver({ method: "future/notice" });
  await flush();
  expect(writes().slice(2)).toEqual([
    { jsonrpc: "2.0", id: "read", result: { content: "contents" } },
    { jsonrpc: "2.0", id: "write", result: null },
    {
      jsonrpc: "2.0",
      id: "permission",
      result: { outcome: { outcome: "selected", optionId: "yes" } },
    },
    { jsonrpc: "2.0", id: "unknown", result: null },
  ]);
  expect(writeFileSync).toHaveBeenCalledWith("/fixture", "new");
  client.stop();
});
test("custom permission resolver and callback failures return protocol errors", async () => {
  const onPermission = vi
    .fn()
    .mockResolvedValueOnce("chosen")
    .mockRejectedValueOnce(new Error("permission failed"));
  const client = await started({ onPermission });
  deliver({ id: 10, method: "session/request_permission", params: {} });
  await flush();
  expect(writes().at(-1).result.outcome.optionId).toBe("chosen");
  deliver({ id: 11, method: "session/request_permission", params: {} });
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("read denied");
  });
  vi.mocked(writeFileSync).mockImplementation(() => {
    throw new Error("write denied");
  });
  deliver({ id: 12, method: "fs/read_text_file", params: {} });
  deliver({ id: 13, method: "fs/write_text_file", params: {} });
  await flush();
  expect(writes().slice(-3)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 11,
        error: { code: -32000, message: "permission failed" },
      }),
      expect.objectContaining({
        id: 12,
        error: { code: -32000, message: "read denied" },
      }),
      expect.objectContaining({
        id: 13,
        error: { code: -32000, message: "write denied" },
      }),
    ]),
  );
  client.stop();
});
test.each([{}, { options: [{ optionId: "first" }] }])(
  "default permissions use fallback options %j",
  async (params) => {
    const client = await started();
    deliver({ id: 10, method: "session/request_permission", params });
    await flush();
    expect(writes().at(-1).result.outcome.optionId).toBe(
      "options" in params ? "first" : "allow",
    );
    client.stop();
  },
);
test.each(["error", "exit", "stdin", "timeout", "oversized"])(
  "%s settles pending handshake and allows cleanup",
  async (mode) => {
    const onExit = vi.fn();
    const client = new AcpClient(
      "opencode",
      "/private",
      { onExit },
      undefined,
      50,
    );
    const start = client.start();
    const failure = expect(start).rejects.toThrow();
    if (mode === "error") p.child.emit("error", new Error("ENOENT"));
    if (mode === "exit") {
      p.child.emit("exit", 7);
      expect(onExit).toHaveBeenCalledWith(7);
    }
    if (mode === "stdin") p.child.stdin.emit("error", new Error("EPIPE"));
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(50);
    if (mode === "oversized") p.child.stdout.emit("data", "x".repeat(4000001));
    await failure;
    client.stop();
    expect(stopOwned).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);
test("invalid sessions, destroyed stdin and prompt timeout are rejected", async () => {
  const client = new AcpClient("opencode", "/private");
  const start = client.start();
  const failure = expect(start).rejects.toThrow("Invalid ACP session/new");
  deliver({ id: 1, result: {} });
  await flush();
  deliver({ id: 2, result: {} });
  await failure;
  client.stop();
  const next = await started();
  p.child.stdin.destroyed = true;
  await expect(next.prompt("x")).rejects.toThrow("not running");
  p.child.stdin.destroyed = false;
  const prompt = next.prompt("long");
  const timeout = expect(prompt).rejects.toThrow("ACP timeout: session/prompt");
  await vi.advanceTimersByTimeAsync(600000);
  await timeout;
  expect(vi.getTimerCount()).toBe(0);
});
