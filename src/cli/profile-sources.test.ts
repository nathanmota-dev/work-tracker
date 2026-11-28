import { beforeEach, expect, test, vi } from "vitest";
import { notifyChange } from "../db/notify.ts";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "../profile/evidence.ts";
import { importProfileAssets } from "../profile/import.ts";
import { profileSourcesState } from "../profile/state.ts";
import { cliSpies } from "../test/doubles.ts";
import { profileCmd } from "./profile-sources.ts";

vi.mock("../db/notify.ts", () => ({ notifyChange: vi.fn() }));
vi.mock("../preparation/sources.ts", () => ({ sourcesConfig: vi.fn() }));
vi.mock("../profile/evidence.ts", () => ({ isFolder: vi.fn() }));
vi.mock("../profile/import.ts", () => ({ importProfileAssets: vi.fn() }));
vi.mock("../profile/state.ts", () => ({ profileSourcesState: vi.fn() }));

let output: ReturnType<typeof cliSpies>;
const config = { profileDir: "/profile" } as never;
beforeEach(() => {
  output = cliSpies();
  vi.mocked(sourcesConfig).mockReturnValue(config);
  vi.mocked(isFolder).mockReturnValue(true);
  vi.mocked(profileSourcesState).mockReturnValue({ profileDir: "/profile", conflicts: [] } as never);
  vi.mocked(importProfileAssets).mockResolvedValue({ imported: 1, cached: 2, failed: 0 });
});
const printed = () => JSON.parse(String(output.log.mock.calls.at(-1)![0])) as unknown;

test("prints the profile sources as JSON", async () => {
  await profileCmd("sources", {});
  expect(printed()).toEqual({ profileDir: "/profile", conflicts: [] });
  expect(importProfileAssets).not.toHaveBeenCalled();
});

test("imports the folder, notifies the backend and prints the result", async () => {
  await profileCmd("import", { force: true });
  expect(importProfileAssets).toHaveBeenCalledWith("/profile", { force: true });
  expect(notifyChange).toHaveBeenCalledWith("profile_imports");
  expect(printed()).toEqual({ imported: 1, cached: 2, failed: 0, profileDir: "/profile", conflicts: [] });
  expect(profileSourcesState).toHaveBeenLastCalledWith(config);
  await profileCmd("import", { force: "yes" });
  expect(importProfileAssets).toHaveBeenLastCalledWith("/profile", { force: false });
});

test("explains a missing folder and an unknown subcommand", async () => {
  vi.mocked(isFolder).mockReturnValue(false);
  await expect(profileCmd("import", {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: Add a file to your profile first.");
  await expect(profileCmd("other", {})).rejects.toThrow("exit:1");
  expect(output.error).toHaveBeenLastCalledWith("error: unknown profile subcommand: other (use sources or import)");
  expect(notifyChange).not.toHaveBeenCalled();
});
