import { failure, postBody } from "../preparation/http.ts";
import { PreparationError, sourcesConfig } from "../preparation/sources.ts";
import { syncProfileAnswers } from "./autofill.ts";
import { isFolder } from "./evidence.ts";
import { importProfileAssets } from "./import.ts";
import { profileSourcesState } from "./state.ts";
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
  if (!folder && body.force === true) throw new PreparationError("Add a file to your profile first.", 409);
  if (folder) await importProfileAssets(config.profileDir, { force: body.force === true });
  syncProfileAnswers();
  return profileSourcesState(config);
}
/** Copy one file into the profile folder and import it before answering. */
async function upload(body: Record<string, unknown>): Promise<ProfileSourcesState & { upload: UploadResult }> {
  const { dir, result } = await uploadProfileFile(body);
  if (result.status !== "replace_required") { await importProfileAssets(dir); syncProfileWatch(); syncProfileAnswers(); }
  return { ...profileSourcesState(), upload: result };
}

/**
 * GET /api/profile-sources; POST /api/profile-sources/import (`force` extracts
 * every PDF again) and /api/profile-sources/upload (`{ name, base64, replace? }`,
 * one file per request). Writes change the profile, so they are announced as
 * `profile_imports` changes; an upload can also change the resume sources. Both
 * also fill empty answers, announced as `applicant_answers`.
 */
export async function handleProfileSources(path: string, req: Request, broadcast: Broadcast): Promise<Response> {
  try {
    if (path === "/api/profile-sources" && req.method === "GET") return Response.json(currentState());
    const body = await postBody(req);
    if (!body) return Response.json({ error: "Method not allowed." }, { status: 405 });
    const write = path === "/api/profile-sources/import" ? importAgain : path === "/api/profile-sources/upload" ? upload : null;
    if (!write) return Response.json({ error: "Not found." }, { status: 404 });
    const state = await write(body);
    broadcast({ type: "changed", table: "profile_imports" });
    broadcast({ type: "changed", table: "applicant_answers" });
    if (write === upload) broadcast({ type: "changed", table: "resume_sources" });
    return Response.json(state);
  } catch (error) { return failure(error); }
}
