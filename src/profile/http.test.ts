import { beforeEach, expect, test, vi } from "vitest";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "./evidence.ts";
import { syncProfileAnswers } from "./autofill.ts";
import { handleProfileSources } from "./http.ts";
import { importProfileAssets } from "./import.ts";
import { profileSourcesState } from "./state.ts";
import { saveChoice } from "./store.ts";
import type { ProfileSourcesState } from "./types.ts";

vi.mock("../preparation/sources.ts", async (original) => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn() }));
vi.mock("./evidence.ts", () => ({ isFolder: vi.fn() }));
vi.mock("./autofill.ts", () => ({ syncProfileAnswers: vi.fn() }));
vi.mock("./import.ts", () => ({ importProfileAssets: vi.fn() }));
vi.mock("./state.ts", () => ({ profileSourcesState: vi.fn() }));
vi.mock("./store.ts", () => ({ saveChoice: vi.fn() }));

const conflict = { key: "k1", field: "work.start", label: "Northwind Labs: start date", values: { data: "2022-11", linkedin: "2022-12" }, chosen: null };
const state = { profileDir: "/profile", conflicts: [conflict] } as unknown as ProfileSourcesState;
const broadcast = vi.fn();
const call = (path: string, method = "GET", body?: unknown) =>
  handleProfileSources(`/api/profile-sources${path}`, new Request("http://localhost", { method, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }), broadcast);
beforeEach(() => {
  vi.mocked(profileSourcesState).mockReturnValue(state);
  vi.mocked(sourcesConfig).mockReturnValue({ profileDir: "/profile" } as never);
  vi.mocked(isFolder).mockReturnValue(true);
});

test("reads the state and imports again, announcing the change", async () => {
  expect(await (await call("")).json()).toEqual(state);
  expect(await (await call("/import", "POST", { force: true })).json()).toEqual(state);
  expect(importProfileAssets).toHaveBeenCalledWith("/profile", { force: true });
  await call("/import", "POST", {});
  expect(importProfileAssets).toHaveBeenLastCalledWith("/profile", { force: false });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "profile_imports" });
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "applicant_answers" });
  expect(syncProfileAnswers).toHaveBeenCalledTimes(2);
});

test("without a profile folder, a sync still fills answers from the data file but Import again is refused", async () => {
  vi.mocked(isFolder).mockReturnValue(false);
  expect((await call("/import", "POST", {})).status).toBe(200);
  expect(importProfileAssets).not.toHaveBeenCalled();
  expect(syncProfileAnswers).toHaveBeenCalledOnce();
  const missing = await call("/import", "POST", { force: true });
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
