import type { SessionManager } from "./session.ts";
import type { PermissionAnswer } from "./permission-types.ts";
import { PermissionError } from "./permission-policy.ts";

export async function handlePermissions(path: string, req: Request, permissions?: SessionManager["permissions"]): Promise<Response> {
  if (!permissions) return Response.json({ error: "Agent permissions unavailable." }, { status: 503 });
  try {
    if (path === "/api/acp/permissions" && req.method === "GET") return Response.json(permissions.snapshot());
    if (req.method !== "POST") return Response.json({ error: "Unsupported permission action." }, { status: 405 });
    const input = await req.json() as Record<string, unknown> | null;
    if (!input || typeof input !== "object") throw new PermissionError("Invalid permission action.");
    if (path === "/api/acp/permissions/answer") permissions.answer(input as PermissionAnswer);
    else if (path === "/api/acp/permissions/rule") {
      if (typeof input.enabled !== "boolean" || (input.sessionId !== undefined && typeof input.sessionId !== "string")) throw new PermissionError("Invalid rule action.");
      permissions.setRule(input, input.enabled, input.sessionId);
    } else return new Response("not found", { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof PermissionError ? error.status : error instanceof SyntaxError ? 400 : 500 });
  }
}
