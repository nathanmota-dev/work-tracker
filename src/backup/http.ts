import { createBackup } from "./create.ts";
import { BackupError, errorText } from "./format.ts";
import { inspectBackup } from "./inspect.ts";
import { restoreBackup } from "./restore.ts";

/**
 * @property busy True while an agent, preparation, diagnostic or browser sign-in is active;
 *   backup and restore are refused rather than racing with its writes.
 */
export interface BackupContext {
  busy: () => boolean;
  broadcast: (event: unknown) => void;
}

const BUSY = "Finish or cancel the active execution before backing up or restoring the workspace.";

export async function handleWorkspaceBackup(path: string, req: Request, { busy, broadcast }: BackupContext): Promise<Response> {
  try {
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const raw: unknown = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BackupError("Expected a JSON object.");
    const body = raw as Record<string, unknown>;
    switch (path) {
      case "/api/workspace-backup/create":
        if (busy()) throw new BackupError(BUSY, 409);
        return Response.json(createBackup(body.destination));
      case "/api/workspace-backup/inspect":
        return Response.json(inspectBackup(body.path).summary);
      case "/api/workspace-backup/restore": {
        if (busy()) throw new BackupError(BUSY, 409);
        const result = restoreBackup(body.path, body.fingerprint);
        broadcast({ type: "changed" });
        return Response.json(result);
      }
      default: return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: error instanceof BackupError ? error.status : 500 });
  }
}
