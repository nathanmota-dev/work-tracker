import type { PreparationService } from "./service.ts";
import { PreparationError, saveSources } from "./sources.ts";
import { pdfBytes } from "./store.ts";
export async function handlePreparation(path: string, req: Request, service: PreparationService): Promise<Response> {
  try {
    if (path === "/api/resume-sources" && req.method === "GET") return Response.json(await service.sourcesState());
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const raw: unknown = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PreparationError("Expected a JSON object.");
    const body = raw as Record<string, unknown>;
    switch (path) {
      case "/api/resume-sources":
        if (service.isBusy) throw new PreparationError("Finish or cancel the active execution before changing sources.", 409);
        saveSources(body); return Response.json(await service.sourcesState());
      case "/api/resume-sources/preview": return Response.json(await service.preview());
      case "/api/application-preparation/details": return Response.json(service.details(body));
      case "/api/application-preparation/description": service.description(body); return Response.json({ ok: true });
      case "/api/application-preparation/generate": return Response.json(service.generate(body), { status: 202 });
      case "/api/application-preparation/fill": return Response.json(service.fill(body), { status: 202 });
      case "/api/application-preparation/submitted": service.submitted(body); return Response.json({ ok: true });
      case "/api/application-preparation/cancel": await service.cancel(body.runId ? String(body.runId) : undefined); return Response.json({ ok: true });
      case "/api/application-preparation/pdf": return new Response(new Uint8Array(pdfBytes(String(body.artifactId ?? ""))), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PreparationError ? error.status : 500 });
  }
}
