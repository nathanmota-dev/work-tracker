import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { snapshotSources } from "./sources.ts";
import { writeFillContext } from "./fill-context.ts";
vi.mock("../paths.ts", () => ({ paths: { home: "/home" } }));
vi.mock("./sources.ts", () => ({ snapshotSources: vi.fn() }));

const written = () => JSON.parse(String(vi.mocked(fs.writeFileSync).mock.lastCall![1]));
beforeEach(() => {
  vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  vi.mocked(fs.readdirSync).mockReturnValue(["index.md", "b.md", "notes.txt", "a.md"] as never);
  vi.mocked(fs.readFileSync).mockImplementation(path => `text of ${String(path)}`);
});

test("collects the approved resume, its saved profile and the experience bank", () => {
  writeFillContext({ text: "Resume", data: { name: "Ana" } }, "/run/fill-context.json");
  expect(fs.writeFileSync).toHaveBeenCalledWith("/run/fill-context.json", expect.any(String), { mode: 0o600 });
  expect(written()).toEqual({ resume: "Resume", profile: { name: "Ana" }, experience: [
    { file: "a.md", text: "text of /home/experience/a.md" }, { file: "b.md", text: "text of /home/experience/b.md" },
  ] });
  expect(snapshotSources).not.toHaveBeenCalled();
});

test("a version without a profile uses the current one, and missing sources are left out", () => {
  vi.mocked(snapshotSources).mockReturnValue({ data: { name: "Current" } } as unknown as ReturnType<typeof snapshotSources>);
  writeFillContext({ text: "Resume", data: null }, "/run/fill-context.json");
  expect(written().profile).toEqual({ name: "Current" });
  vi.mocked(snapshotSources).mockImplementation(() => { throw new Error("no project"); });
  vi.mocked(fs.readdirSync).mockImplementation(() => { throw new Error("ENOENT"); });
  writeFillContext({ text: "Resume", data: null }, "/run/fill-context.json");
  expect(written()).toEqual({ resume: "Resume", profile: null, experience: [] });
});
