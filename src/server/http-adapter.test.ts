import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { nodeRequestListener } from "./http-adapter.ts";

function incoming(method: string, headers: Record<string, string | string[] | undefined>, chunks: Buffer[] = []) {
  return Object.assign(new EventEmitter(), {
    method,
    url: "/api/jobs",
    headers,
    async *[Symbol.asyncIterator]() { yield* chunks; },
  });
}
function outgoing() {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  response.writeHead.mockReturnValue(response);
  return response;
}

test("joins repeated headers and omits bodies for HEAD requests", async () => {
  const handler = vi.fn(async (req: Request) => {
    expect(req.method).toBe("HEAD");
    expect(req.headers.get("accept")).toBe("text/plain,application/json");
    expect(req.headers.has("x-empty")).toBe(false);
    return new Response(null, { status: 204, headers: { "x-result": "ok" } });
  });
  const res = outgoing();
  await nodeRequestListener(handler)(incoming("HEAD", { accept: ["text/plain", "application/json"], "x-empty": undefined }) as never, res as never);
  expect(handler).toHaveBeenCalledOnce();
  expect(res.writeHead).toHaveBeenCalledWith(204, { "x-result": "ok" });
});

test("rejects oversized bodies and reports handler failures", async () => {
  const handler = vi.fn(async () => { throw new Error("boom"); });
  const tooLarge = outgoing();
  await nodeRequestListener(handler)(incoming("POST", {}, [Buffer.alloc(1024 * 1024 + 1)]) as never, tooLarge as never);
  expect(tooLarge.writeHead).toHaveBeenCalledWith(413);
  expect(handler).not.toHaveBeenCalled();
  const failed = outgoing();
  await nodeRequestListener(handler)(incoming("POST", {}, [Buffer.from("{}")]) as never, failed as never);
  expect(failed.writeHead).toHaveBeenCalledWith(500, { "content-type": "application/json" });
  expect(failed.end).toHaveBeenCalledWith(JSON.stringify({ error: "Error: boom" }));
});
