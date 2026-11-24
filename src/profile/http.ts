import { failure, postBody } from "../preparation/http.ts";
import { PreparationError, sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "./evidence.ts";
import { importProfileAssets } from "./import.ts";
import { profileSourcesState } from "./state.ts";
import { saveChoice } from "./store.ts";
import type { ProfileSourcesState } from "./types.ts";

type Broadcast = (event: unknown) => void;

async function importAgain(body: Record<string, unknown>): Promise<ProfileSourcesState> {
  const config = sourcesConfig();
  if (!isFolder(config.profileDir)) throw new PreparationError("Choose an existing profile folder in Resume sources first.", 409);
  await importProfileAssets(config.profileDir, { force: body.force === true });
  return profileSourcesState(config);
}
/** Record the decision for a conflict that still exists; `source: null` is "Decide later". */
function choose(body: Record<string, unknown>): ProfileSourcesState {
  const { key, source } = body;
  if (source !== null && source !== "data" && source !== "linkedin") throw new PreparationError("Choose data, linkedin or null as the source.");
  const conflict = profileSourcesState().conflicts.find(item => item.key === key);
  if (!conflict) throw new PreparationError("This conflict no longer exists. Refresh the profile sources.", 404);
  saveChoice(conflict.key, source ? { field: conflict.field, source, value: conflict.values[source] } : null);
  return profileSourcesState();
}

/**
 * GET /api/profile-sources; POST /api/profile-sources/import (`force` extracts
 * every PDF again) and /api/profile-sources/choice. Both writes change the
 * consolidated profile, so they are announced as `profile_imports` changes.
 */
export async function handleProfileSources(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  try {
    if (path === "/api/profile-sources" && req.method === "GET") return Response.json(profileSourcesState());
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    const write = path === "/api/profile-sources/import" ? importAgain : path === "/api/profile-sources/choice" ? choose : null;
    if (!write) return Response.json({ error: "Not found." }, { status: 404 });
    const state = await write(body);
    broadcast({ type: "changed", table: "profile_imports" });
    return Response.json(state);
  } catch (error) { return failure(error); }
}
