import { failure, postBody } from "../preparation/http.ts";
import { PreparationError, sourcesConfig } from "../preparation/sources.ts";
import { syncProfileAnswers } from "./autofill.ts";
import { isFolder } from "./evidence.ts";
import { importProfileAssets } from "./import.ts";
import { profileSourcesState } from "./state.ts";
import { saveChoice } from "./store.ts";
import type { ProfileSourcesState } from "./types.ts";
import { uploadProfileFile, type UploadResult } from "./upload.ts";
import { importPending, profileImporting, syncProfileWatch } from "./watch.ts";

type Broadcast = (event: unknown) => void;

/** The state, with any file still waiting for an import picked up in the background. */
function currentState(): ProfileSourcesState {
  syncProfileWatch();
  const state = profileSourcesState();
  if (!profileImporting() && state.profileDir && state.assets.some(asset => asset.status === "pending")) void importPending(state.profileDir);
  return { ...state, importing: profileImporting() || state.assets.some(asset => asset.status === "pending") };
}
async function importAgain(body: Record<string, unknown>): Promise<ProfileSourcesState> {
  const config = sourcesConfig();
  const folder = isFolder(config.profileDir);
  // Without a folder, a plain sync still fills answers from the data file; only "Import again" needs one.
  if (!folder && body.force === true) throw new PreparationError("Choose an existing profile folder in Resume sources first.", 409);
  if (folder) await importProfileAssets(config.profileDir, { force: body.force === true });
  syncProfileAnswers();
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
/** Copy one file into the profile folder and import it before answering. */
async function upload(body: Record<string, unknown>): Promise<ProfileSourcesState & { upload: UploadResult }> {
  const { dir, result } = uploadProfileFile(body);
  if (result.status !== "replace_required") { await importProfileAssets(dir); syncProfileWatch(); syncProfileAnswers(); }
  return { ...profileSourcesState(), upload: result };
}

/**
 * GET /api/profile-sources; POST /api/profile-sources/import (`force` extracts
 * every PDF again), /api/profile-sources/choice and /api/profile-sources/upload
 * (`{ name, base64, replace? }`, one file per request). Writes change the
 * consolidated profile, so they are announced as `profile_imports` changes; an
 * upload can also change the resume sources. An import or an upload also fills
 * empty answers, announced as `applicant_answers`.
 */
export async function handleProfileSources(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  try {
    if (path === "/api/profile-sources" && req.method === "GET") return Response.json(currentState());
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    const write = path === "/api/profile-sources/import" ? importAgain : path === "/api/profile-sources/choice" ? choose : path === "/api/profile-sources/upload" ? upload : null;
    if (!write) return Response.json({ error: "Not found." }, { status: 404 });
    const state = await write(body);
    broadcast({ type: "changed", table: "profile_imports" });
    if (write !== choose) broadcast({ type: "changed", table: "applicant_answers" });
    if (write === upload) broadcast({ type: "changed", table: "resume_sources" });
    return Response.json(state);
  } catch (error) { return failure(error); }
}
