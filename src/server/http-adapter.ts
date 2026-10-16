import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 1024 * 1024;

/** Adapts a Node HTTP request to the Fetch API handler used by the backend. */
export function nodeRequestListener(handleRequest: (req: Request) => Promise<Response>) {
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          outgoing.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const method = incoming.method ?? "GET";
      const req = new Request(`http://127.0.0.1${incoming.url}`, {
        method,
        headers,
        ...(method !== "GET" && method !== "HEAD"
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await handleRequest(req);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: String(error) }));
    }
  };
}
