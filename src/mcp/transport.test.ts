import { beforeEach, expect, test, vi } from "vitest";
import { OwnedStdioTransport } from "./transport.ts";
import { spawnOwned, stopOwned } from "../acp/process.ts";
import { processDouble } from "../test/doubles.ts";
vi.mock("../acp/process.ts", () => ({
  spawnOwned: vi.fn(),
  stopOwned: vi.fn(),
}));
let p: ReturnType<typeof processDouble>, transport: OwnedStdioTransport;
beforeEach(() => {
  vi.useFakeTimers();
  p = processDouble();
  vi.mocked(spawnOwned).mockReturnValue(p.asChild);
  transport = new OwnedStdioTransport({
    command: "mcp",
    args: ["--flag"],
    env: { TOKEN: "fixture" },
    cwd: "/private",
  });
});
async function start() {
  const starting = transport.start();
  p.child.emit("spawn");
  await starting;
}
test("transport waits for spawn, serializes messages and parses fragmented multiple messages", async () => {
  const onmessage = vi.fn();
  transport.onmessage = onmessage;
  await start();
  expect(spawnOwned).toHaveBeenCalledWith("mcp", ["--flag"], {
    env: { TOKEN: "fixture" },
    cwd: "/private",
  });
  expect(p.child.stderr.resume).toHaveBeenCalledOnce();
  await transport.send({ jsonrpc: "2.0", id: 1, method: "ping" });
  expect(p.child.stdin.write.mock.calls[0][0]).toBe(
    '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
  );
  p.child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"res'));
  p.child.stdout.emit(
    "data",
    Buffer.from('ult":{}}\n{"jsonrpc":"2.0","method":"notice"}\n'),
  );
  expect(onmessage.mock.calls).toEqual([
    [{ jsonrpc: "2.0", id: 1, result: {} }],
    [{ jsonrpc: "2.0", method: "notice" }],
  ]);
  const closing = transport.close();
  p.child.emit("close");
  await closing;
  await transport.close();
  expect(vi.getTimerCount()).toBe(0);
});
test("send rejects absent, destroyed and failing stdin", async () => {
  await expect(
    transport.send({ jsonrpc: "2.0", method: "ping" }),
  ).rejects.toThrow("not running");
  await start();
  p.child.stdin.destroyed = true;
  await expect(
    transport.send({ jsonrpc: "2.0", method: "ping" }),
  ).rejects.toThrow("not running");
  p.child.stdin.destroyed = false;
  p.child.stdin.write.mockImplementation((_data, cb) => {
    cb?.(new Error("EPIPE"));
    return false;
  });
  await expect(
    transport.send({ jsonrpc: "2.0", method: "ping" }),
  ).rejects.toThrow("EPIPE");
  const closing = transport.close();
  await vi.advanceTimersByTimeAsync(500);
  await closing;
});
test("spawn and stdin errors are surfaced; malformed messages stop the owned process", async () => {
  const onerror = vi.fn(),
    onclose = vi.fn();
  transport.onerror = onerror;
  transport.onclose = onclose;
  const starting = transport.start();
  const rejected = expect(starting).rejects.toThrow("ENOENT");
  p.child.emit("error", new Error("ENOENT"));
  await rejected;
  p.child.stdin.emit("error", new Error("EPIPE"));
  expect(onerror).toHaveBeenCalledTimes(2);
  p.child.stdout.emit("data", Buffer.from("not-json\n"));
  expect(onerror).toHaveBeenCalledTimes(3);
  expect(stopOwned).toHaveBeenCalledWith(p.asChild);
  p.child.emit("close");
  await Promise.resolve();
  expect(onclose).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
test("oversized messages close transport; shutdown timeout completes when no close event arrives", async () => {
  const onerror = vi.fn();
  transport.onerror = onerror;
  await start();
  p.child.stdout.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1, 120));
  expect(onerror).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  await expect(transport.close()).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
