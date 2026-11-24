import type { PreparationService } from "./service.ts";
import { PreparationError, saveSources, sourcesConfig } from "./sources.ts";
import { ensureProfileImported } from "../profile/import.ts";
import { pdfBytes } from "./store.ts";
import { JourneyError } from "../applications/journey.ts";
export async function handlePreparation(path: string, req: Request, service: PreparationService): Promise<Response> {
  try {
    if (path === "/api/resume-sources" && req.method === "GET") return Response.json(await service.sourcesState());
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    switch (path) {
      case "/api/resume-sources":
        if (service.isBusy) throw new PreparationError("Finish or cancel the active execution before changing sources.", 409);
        saveSources(body); return Response.json(await service.sourcesState());
      case "/api/resume-sources/preview": return Response.json(await service.preview());
      case "/api/application-preparation/details": return Response.json(service.details(body));
      case "/api/application-preparation/description": service.description(body); return Response.json({ ok: true });
      case "/api/application-preparation/generate": await ensureProfileImported(sourcesConfig().profileDir); return Response.json(service.generate(body), { status: 202 });
      case "/api/application-preparation/approve": return Response.json(service.approve(body));
      case "/api/application-preparation/fill": return Response.json(service.fill(body), { status: 202 });
      case "/api/application-preparation/retry": await ensureProfileImported(sourcesConfig().profileDir); return Response.json(service.retry(body), { status: 202 });
      case "/api/application-preparation/submitted": return Response.json({ ok: true, ...service.submitted(body) });
      case "/api/application-preparation/cancel": await service.cancel(body.runId ? String(body.runId) : undefined); return Response.json({ ok: true });
      case "/api/application-preparation/pdf": return new Response(new Uint8Array(pdfBytes(String(body.artifactId ?? ""))), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) { return failure(error); }
}
/** The JSON object of a POST request; null for other methods. */
export async function postBody(req: Request): Promise<Record<string, unknown> | null> {
  if (req.method !== "POST") return null;
  const raw: unknown = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PreparationError("Expected a JSON object.");
  return raw as Record<string, unknown>;
}
export function failure(error: unknown): Response {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PreparationError || error instanceof JourneyError ? error.status : 500 });
}
