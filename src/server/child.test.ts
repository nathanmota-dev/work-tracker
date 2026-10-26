import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { startBackend } from "./index.ts";
import { backendChild } from "./child.ts";
vi.mock("./index.ts", () => ({ startBackend: vi.fn() }));

let handlers: Map<string, (data?: unknown) => void>, send: ReturnType<typeof vi.fn>;
const backend = { address: "http://127.0.0.1:47830", port: 47830, token: "t", close: vi.fn() };
// The test runner may talk to its own parent through process.send.
const originalSend = process.send;
afterEach(() => { process.send = originalSend; });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => {
  handlers = new Map();
  send = vi.fn();
  backend.close.mockReset().mockResolvedValue(undefined);
  vi.mocked(startBackend).mockResolvedValue(backend as never);
  vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => { handlers.set(event, listener); return process; }) as typeof process.on);
  Object.assign(process, { send });
});

test("reports readiness, asks to stop when idle and shuts down once before exiting", async () => {
  await backendChild({ port: "47830" });
  expect(send).toHaveBeenCalledWith({ type: "ready", address: backend.address, port: 47830, token: "t" });
  vi.mocked(startBackend).mock.calls[0]![1]!.onIdle!();
  expect(send).toHaveBeenLastCalledWith({ type: "idle" });
  handlers.get("SIGINT")!();
  handlers.get("message")!({ type: "exit" });
  handlers.get("message")!({ type: "shutdown" });
  handlers.get("SIGTERM")!();
  await settle();
  expect(backend.close).toHaveBeenCalledOnce();
  expect(send).toHaveBeenLastCalledWith({ type: "stopped" });
  vi.mocked(process.exit).mockImplementationOnce((() => undefined) as never);
  handlers.get("message")!({ type: "exit" });
  expect(process.exit).toHaveBeenCalledWith(0);
});

test("a shutdown requested during startup stops without reporting readiness", async () => {
  let started!: (value: typeof backend) => void;
  vi.mocked(startBackend).mockReturnValue(new Promise(resolve => { started = resolve; }) as never);
  const running = backendChild({});
  handlers.get("message")!({ type: "shutdown" });
  started(backend);
  await running;
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ready" }));
  expect(send).toHaveBeenCalledWith({ type: "stopped" });
});

test("reports a failed start and exits", async () => {
  vi.mocked(startBackend).mockRejectedValue(new Error("EADDRINUSE"));
  vi.mocked(process.exit).mockImplementationOnce((() => undefined) as never);
  await backendChild({});
  expect(send).toHaveBeenCalledWith({ type: "failed", message: "Error: EADDRINUSE" });
  expect(process.exit).toHaveBeenCalledWith(1);
});
