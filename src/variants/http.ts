import { ensureProfileImported } from "../profile/import.ts";
import { failure, postBody } from "../preparation/http.ts";
import { sourcesConfig } from "../preparation/sources.ts";
import type { VariantService } from "./service.ts";
import { importVariantPdf } from "./import.ts";

/** `/api/resume-variants`: list, generate, regenerate, edit, edit LaTeX, archive, cancel and import saved resumes. */
export async function handleVariants(path: string, req: Request, service: VariantService, broadcast: (event: unknown) => void): Promise<Response> {
  try {
    if (path === "/api/resume-variants" && req.method === "GET") return Response.json(service.list({ includeArchived: new URL(req.url).searchParams.get("archived") === "true" }));
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    switch (path) {
      case "/api/resume-variants/generate": await ensureProfileImported(sourcesConfig().profileDir); return Response.json(service.generate(body), { status: 202 });
      case "/api/resume-variants/regenerate": await ensureProfileImported(sourcesConfig().profileDir); return Response.json(service.regenerate(body), { status: 202 });
      case "/api/resume-variants/update": return Response.json(service.update(body));
      case "/api/resume-variants/latex": return Response.json(service.latex(body));
      case "/api/resume-variants/save-latex": return Response.json(await service.saveLatex(body));
      case "/api/resume-variants/archive": return Response.json(service.archive(body));
      case "/api/resume-variants/cancel": await service.cancel(body); return Response.json({ ok: true });
      case "/api/resume-variants/import": {
        const id = await importVariantPdf(body);
        broadcast({ type: "changed", table: "resume_variants", variantId: id });
        broadcast({ type: "changed", table: "activity_log" });
        return Response.json(service.get(id), { status: 201 });
      }
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) { return failure(error); }
}
