import { beforeEach, expect, test, vi } from "vitest";
import { diagnosticUsername, failureCheck, probeIntegration } from "./probe.ts";
const fake = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), availableModels: ["fixture/model"], connect: vi.fn(), listTools: vi.fn(), callTool: vi.fn(), close: vi.fn(), transportClose: vi.fn(), prepare: vi.fn(), answer: undefined as { value: string } | undefined, username: "synthetic" as string | undefined }));
vi.mock("../acp/client.ts", () => ({ AcpClient: class { start = fake.start; stop = fake.stop; availableModels = fake.availableModels } }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: class { connect = fake.connect; listTools = fake.listTools; callTool = fake.callTool; close = fake.close } }));
vi.mock("../mcp/transport.ts", () => ({ OwnedStdioTransport: class { close = fake.transportClose } }));
vi.mock("../db/index.ts", () => ({ db: () => ({ query: () => ({ get: () => fake.answer }) }) }));
vi.mock("../paths.ts", () => ({ paths: { workspace: "/fixture" }, loadConfig: () => ({ username: fake.username }) }));
vi.mock("../mcp/config.ts", () => ({ mcpServers: () => [{ name: "chrome", command: "fixture", args: [], env: {} }, { name: "linkedin", command: "fixture", args: [], env: {} }] }));
vi.mock("../acp/providers.ts", () => ({ getProvider: () => ({ command: () => ({ cmd: ["fixture"] }) }) }));
vi.mock("../cli/skills.ts", () => ({ agentEnvironment: () => ({}), prepareWorkspace: () => fake.prepare() }));
beforeEach(() => {
  vi.clearAllMocks(); fake.username = "synthetic"; fake.answer = undefined;
  fake.start.mockResolvedValue(undefined); fake.connect.mockResolvedValue(undefined); fake.listTools.mockResolvedValue({ tools: [{ name: "list_pages" }, { name: "get_person_profile" }] });
  fake.callTool.mockResolvedValue({ content: [{ type: "text", text: "synthetic profile" }] }); fake.close.mockResolvedValue(undefined); fake.transportClose.mockResolvedValue(undefined);
});
test.each([["timeout secret-token", "timeout"], ["401 Bearer secret-token", "authentication_required"], ["login pending secret-token", "authentication_required"], ["failed secret-token", "failed"]])("classifies errors privately", (message, state) => {
  const check = failureCheck(new Error(message), "connection"); expect(check.state).toBe(state); expect(JSON.stringify(check)).not.toContain("secret-token");
});
test("unknown thrown values remain private", () => expect(failureCheck("secret", "connection").state).toBe("failed"));
test("successful ACP probes validate advertised models without prompting", async () => {
  expect((await probeIntegration("acp/opencode", "fixture/model")).slice(0, 2).every(check => check.state === "ready")).toBe(true);
  expect(fake.start).toHaveBeenCalledWith(expect.objectContaining({ mcpServers: [] }));
  expect((await probeIntegration("acp/opencode", "invalid"))[1]?.state).toBe("invalid_model");
  expect((await probeIntegration("acp/claude-code"))[1]?.state).toBe("ready");
  expect(fake.stop).toHaveBeenCalledTimes(3);
});
test("failed ACP sessions stop and keep output private", async () => {
  fake.start.mockRejectedValue(new Error("auth required secret"));
  expect((await probeIntegration("acp/opencode"))[0]?.state).toBe("authentication_required");
  expect(fake.stop).toHaveBeenCalled();
});
test("Chrome access does not establish LinkedIn authentication", async () => {
  expect((await probeIntegration("mcp/chrome"))[1]?.message).toContain("does not verify LinkedIn");
  expect(fake.callTool).toHaveBeenLastCalledWith({ name: "list_pages", arguments: {} }, undefined, { timeout: 15000 });
  fake.callTool.mockResolvedValue({ content: [{ type: "text", text: "LinkedIn login is still in progress secret" }] });
  expect((await probeIntegration("mcp/linkedin"))[1]?.state).toBe("authentication_required");
  expect(fake.close).toHaveBeenCalledTimes(2); expect(fake.transportClose).toHaveBeenCalledTimes(2);
});
test("LinkedIn reads its own profile and untestable sessions stay unverified", async () => {
  expect((await probeIntegration("mcp/linkedin"))[1]?.state).toBe("ready");
  fake.username = undefined;
  expect((await probeIntegration("mcp/linkedin"))[1]?.state).toBe("unverified");
  fake.listTools.mockResolvedValue({ tools: [] });
  expect((await probeIntegration("mcp/chrome"))[1]?.state).toBe("unverified");
});
test("MCP errors and cleanup failures never expose raw output", async () => {
  fake.callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "failure secret" }] });
  expect((await probeIntegration("mcp/chrome"))[1]?.state).toBe("failed");
  fake.connect.mockRejectedValue(new Error("timeout secret")); fake.close.mockRejectedValue(new Error("secret")); fake.transportClose.mockRejectedValue(new Error("secret"));
  expect(await probeIntegration("mcp/chrome")).toMatchObject([{ stage: "connection", state: "timeout" }]);
});
test("provider model errors are classified separately from authentication", () => {
  expect(failureCheck(new Error("unknown model secret"), "connection")).toMatchObject({ stage: "model", state: "invalid_model" });
});

test("authentication diagnostics use the LinkedIn username saved through Profile", () => {
  fake.answer = { value: "https://www.linkedin.com/in/synthetic-person/" };
  expect(diagnosticUsername()).toBe("synthetic-person");
});
