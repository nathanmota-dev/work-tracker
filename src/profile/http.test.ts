import { beforeEach, expect, test, vi } from "vitest";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "./evidence.ts";
import { handleProfileSources } from "./http.ts";
import { importProfileAssets } from "./import.ts";
import { profileSourcesState } from "./state.ts";
import { saveChoice } from "./store.ts";
import type { ProfileSourcesState } from "./types.ts";
import { uploadProfileFile } from "./upload.ts";
import { importPending, profileImporting, syncProfileWatch } from "./watch.ts";

vi.mock("../preparation/sources.ts", async (original) => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn() }));
vi.mock("./evidence.ts", () => ({ isFolder: vi.fn() }));
vi.mock("./import.ts", () => ({ importProfileAssets: vi.fn() }));
vi.mock("./state.ts", () => ({ profileSourcesState: vi.fn() }));
vi.mock("./store.ts", () => ({ saveChoice: vi.fn() }));
vi.mock("./upload.ts", () => ({ uploadProfileFile: vi.fn() }));
vi.mock("./watch.ts", () => ({ importPending: vi.fn(), profileImporting: vi.fn(() => false), syncProfileWatch: vi.fn() }));

const conflict = { key: "k1", field: "work.start", label: "Northwind Labs: start date", values: { data: "2022-11", linkedin: "2022-12" }, chosen: null };
const state = { profileDir: "/profile", conflicts: [conflict], assets: [] } as unknown as ProfileSourcesState;
const broadcast = vi.fn();
const call = (path: string, method = "GET", body?: unknown) =>
  handleProfileSources(`/api/profile-sources${path}`, new Request("http://localhost", { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), broadcast);
beforeEach(() => {
  vi.mocked(profileSourcesState).mockReturnValue(state);
  vi.mocked(sourcesConfig).mockReturnValue({ profileDir: "/profile" } as never);
  vi.mocked(isFolder).mockReturnValue(true);
});

test("reads the state and imports again, announcing the change", async () => {
  expect(await (await call("")).json()).toEqual({ ...state, importing: false });
  expect(await (await call("/import", "POST", { force: true })).json()).toEqual(state);
  expect(importProfileAssets).toHaveBeenCalledWith("/profile", { force: true });
  await call("/import", "POST", {});
  expect(importProfileAssets).toHaveBeenLastCalledWith("/profile", { force: false });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "profile_imports" });
  vi.mocked(isFolder).mockReturnValue(false);
  const missing = await call("/import", "POST", {});
  expect([missing.status, await missing.json()]).toEqual([409, { error: "Choose an existing profile folder in Resume sources first." }]);
});

test("records a choice with its value, or forgets it to decide later", async () => {
  expect((await call("/choice", "POST", { key: "k1", source: "linkedin" })).status).toBe(200);
  expect(saveChoice).toHaveBeenCalledWith("k1", { field: "work.start", source: "linkedin", value: "2022-12" });
  await call("/choice", "POST", { key: "k1", source: null });
  expect(saveChoice).toHaveBeenLastCalledWith("k1", null);
  expect(broadcast).toHaveBeenCalledTimes(2);
});

test("rejects unknown conflicts and sources, other methods and paths", async () => {
  const stale = await call("/choice", "POST", { key: "gone", source: "data" });
  expect([stale.status, await stale.json()]).toEqual([404, { error: "This conflict no longer exists. Refresh the profile sources." }]);
  expect((await call("/choice", "POST", { key: "k1", source: "agent" })).status).toBe(400);
  expect((await call("/choice", "POST", "[]")).status).toBe(400);
  expect((await call("/import", "DELETE")).status).toBe(405);
  expect((await call("/other", "POST", {})).status).toBe(404);
  expect(saveChoice).not.toHaveBeenCalled();
  expect(broadcast).not.toHaveBeenCalled();
});

test("a read follows the folder and picks up files waiting for an import", async () => {
  const pending = { ...state, assets: [{ file: "new.pdf", kind: null, status: "pending", warnings: [] }] } as ProfileSourcesState;
  vi.mocked(profileSourcesState).mockReturnValue(pending);
  expect(await (await call("")).json()).toMatchObject({ importing: true });
  expect(syncProfileWatch).toHaveBeenCalled();
  expect(importPending).toHaveBeenCalledWith("/profile");
  vi.mocked(importPending).mockClear();
  vi.mocked(profileImporting).mockReturnValue(true);
  expect(await (await call("")).json()).toMatchObject({ importing: true });
  expect(importPending).not.toHaveBeenCalled();
});

test("uploads a file, imports it and announces the profile and the sources", async () => {
  vi.mocked(uploadProfileFile).mockReturnValue({ dir: "/profile", result: { file: "cv.pdf", kind: "pdf", status: "added" } });
  const body = { name: "cv.pdf", base64: "JVBERg==" };
  expect(await (await call("/upload", "POST", body)).json()).toEqual({ ...state, upload: { file: "cv.pdf", kind: "pdf", status: "added" } });
  expect(uploadProfileFile).toHaveBeenCalledWith(body);
  expect(importProfileAssets).toHaveBeenCalledWith("/profile");
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "resume_sources" });
  vi.mocked(importProfileAssets).mockClear();
  vi.mocked(uploadProfileFile).mockReturnValue({ dir: "/profile", result: { file: "resume-data.json", kind: "data", status: "replace_required" } });
  expect(((await (await call("/upload", "POST", body)).json()) as { upload: { status: string } }).upload.status).toBe("replace_required");
  expect(importProfileAssets).not.toHaveBeenCalled();
});
