import { beforeEach, expect, test, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { OwnedStdioTransport } from "./transport.ts";
import { deferred } from "../test/doubles.ts";
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(),
}));
vi.mock("./transport.ts", () => ({ OwnedStdioTransport: vi.fn() }));
vi.mock("../paths.ts", () => ({
  ensureHome: vi.fn(),
  paths: { workspace: "/private" },
}));
vi.mock("../cli/skills.ts", () => ({
  agentEnvironment: () => ({ PRIVATE: "yes", TOKEN: "parent" }),
}));
vi.mock("./config.ts", () => ({
  mcpServers: () => [
    {
      name: "linkedin",
      command: "mcp",
      args: ["--private"],
      env: { TOKEN: "configured" },
    },
  ],
}));
let c: {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  onclose?: () => void;
};
let t: { close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetModules();
  c = {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: "echo" }] }),
    callTool: vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] }),
  };
  t = { close: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(Client).mockImplementation(function () {
    return c as unknown as Client;
  });
  vi.mocked(OwnedStdioTransport).mockImplementation(function () {
    return t as unknown as OwnedStdioTransport;
  });
});
test("concurrent calls share one connection with the private environment and tool timeout", async () => {
  const pending = deferred();
  c.connect.mockReturnValue(pending.promise);
  const { callTool, listTools, closeMcp } = await import("./linkedin.ts");
  const a = listTools(),
    b = callTool("echo", { value: 1 });
  expect(Client).toHaveBeenCalledOnce();
  pending.resolve();
  expect(await a).toEqual(["echo"]);
  expect(await b).toEqual({ ok: true });
  expect(OwnedStdioTransport).toHaveBeenCalledWith({
    command: "mcp",
    args: ["--private"],
    env: { PRIVATE: "yes", TOKEN: "configured" },
    cwd: "/private",
  });
  expect(c.connect).toHaveBeenCalledWith(t, { timeout: 15000 });
  expect(c.callTool).toHaveBeenCalledWith(
    { name: "echo", arguments: { value: 1 } },
    undefined,
    { timeout: 180000 },
  );
  await listTools();
  expect(Client).toHaveBeenCalledOnce();
  await closeMcp();
  expect(t.close).toHaveBeenCalledOnce();
});
test("tool content parses JSON or raw text and errors propagate", async () => {
  const { callTool, closeMcp } = await import("./linkedin.ts");
  c.callTool.mockResolvedValueOnce({
    content: [
      { type: "image" },
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ],
  });
  expect(await callTool("echo", {})).toEqual({ raw: "first\nsecond" });
  c.callTool.mockResolvedValueOnce({});
  expect(await callTool("empty", {})).toEqual({ raw: "" });
  c.callTool.mockResolvedValueOnce({
    isError: true,
    content: [{ type: "text", text: "denied" }],
  });
  await expect(callTool("bad", {})).rejects.toThrow("denied");
  c.callTool.mockResolvedValueOnce({ isError: true });
  await expect(callTool("bad", {})).rejects.toThrow("MCP tool failed: bad");
  c.callTool.mockRejectedValueOnce(new Error("timeout"));
  await expect(callTool("slow", {})).rejects.toThrow("timeout");
  await closeMcp();
});
test("connection failures close transport and retry; a closed client reconnects", async () => {
  const { listTools, closeMcp } = await import("./linkedin.ts");
  c.connect.mockRejectedValueOnce(new Error("spawn failed"));
  t.close.mockRejectedValueOnce(new Error("already gone"));
  await expect(listTools()).rejects.toThrow("LinkedIn MCP unavailable");
  expect(t.close).toHaveBeenCalledOnce();
  expect(await listTools()).toEqual(["echo"]);
  c.onclose!();
  await listTools();
  expect(Client).toHaveBeenCalledTimes(3);
  await closeMcp();
});
test("preserves structured MCP output even without text and still propagates tool errors", async () => {
  const { callTool, closeMcp } = await import("./linkedin.ts");
  c.callTool.mockResolvedValueOnce({ structuredContent: { jobs: [{ title: "Structured" }] } });
  expect(await callTool("search_jobs", {})).toEqual({ jobs: [{ title: "Structured" }] });
  c.callTool.mockResolvedValueOnce({ structuredContent: { jobs: [] }, content: [{ type: "text", text: "old prose" }] });
  expect(await callTool("search_jobs", {})).toEqual({ jobs: [] });
  c.callTool.mockResolvedValueOnce({ isError: true, structuredContent: { jobs: [] } });
  await expect(callTool("search_jobs", {})).rejects.toThrow("MCP tool failed");
  await closeMcp();
});
test("shutdown cancels a pending connection and permits a fresh attempt", async () => {
  const pending = deferred();
  c.connect.mockReturnValueOnce(pending.promise);
  const { listTools, closeMcp } = await import("./linkedin.ts");
  const call = listTools();
  const failure = expect(call).rejects.toThrow("MCP connection cancelled");
  await closeMcp();
  pending.resolve();
  await failure;
  await listTools();
  expect(Client).toHaveBeenCalledTimes(2);
  await closeMcp();
});
