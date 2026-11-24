import type { PreparationQueue } from "./batch-queue.ts";
import { failure, postBody } from "./http.ts";
import { sourcesConfig } from "./sources.ts";
import { ensureProfileImported } from "../profile/import.ts";

/** Batch queue API: progress for every batch and item, and the queue operations. */
export async function handleBatches(path: string, req: Request, queue: PreparationQueue): Promise<Response> {
  try {
    if (path === "/api/preparation-batches" && req.method === "GET") return Response.json(queue.state());
    if (path.startsWith("/api/preparation-batches/review/") && req.method === "GET") return Response.json(queue.state(decodeURIComponent(path.slice("/api/preparation-batches/review/".length))));
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    switch (path) {
      case "/api/preparation-batches/preview": return Response.json(queue.preview(body));
      case "/api/preparation-batches/create": await ensureProfileImported(sourcesConfig().profileDir); return Response.json(queue.create(body), { status: 201 });
      case "/api/preparation-batches/add": return Response.json(queue.add(body));
      case "/api/preparation-batches/pause": return Response.json(queue.pause(body));
      case "/api/preparation-batches/resume": return Response.json(queue.resume(body));
      case "/api/preparation-batches/cancel": return Response.json(await queue.cancel(body));
      case "/api/preparation-batches/retry": return Response.json(queue.retry(body));
      case "/api/preparation-batches/adjust": return Response.json(queue.adjust(body));
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) { return failure(error); }
}
