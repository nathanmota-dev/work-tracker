import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "./evidence.ts";
import { importProfileAssets } from "./import.ts";
import { importPending, profileImporting, startProfileWatch, stopProfileWatch, syncProfileWatch, WATCH_DEBOUNCE_MS } from "./watch.ts";

vi.mock("../preparation/sources.ts", () => ({ sourcesConfig: vi.fn() }));
vi.mock("./evidence.ts", () => ({ isFolder: vi.fn() }));
vi.mock("./import.ts", () => ({ importProfileAssets: vi.fn() }));

type Watcher = EventEmitter & { close: ReturnType<typeof vi.fn>; dir: string; emit_: (name: string | null) => void };
let watchers: Watcher[];
const onChange = vi.fn();
const imports = () => vi.mocked(importProfileAssets).mock.calls.map(([dir]) => dir);
beforeEach(() => {
  vi.useFakeTimers();
  watchers = [];
  vi.mocked(sourcesConfig).mockReturnValue({ profileDir: "/profile" } as never);
  vi.mocked(isFolder).mockReturnValue(true);
  vi.mocked(importProfileAssets).mockResolvedValue({ imported: 1, cached: 0, failed: 0 });
  vi.spyOn(fs, "watch").mockImplementation(((dir: string, _options: unknown, listener: (event: string, name: string | null) => void) => {
    const watcher = Object.assign(new EventEmitter(), { close: vi.fn(), dir, emit_: (name: string | null) => listener("rename", name) });
    watchers.push(watcher);
    return watcher;
  }) as never);
});
afterEach(() => { stopProfileWatch(); vi.useRealTimers(); });

test("imports what is pending at start and every PDF or data change after a pause", async () => {
  startProfileWatch(onChange);
  expect(fs.watch).toHaveBeenCalledWith("/profile", { persistent: false }, expect.any(Function));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  for (const name of ["cv.pdf", ".upload-1.tmp", "resume-data.json", "Export.PDF"]) watchers[0]!.emit_(name);
  await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS - 1);
  expect(imports()).toEqual(["/profile"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(imports()).toEqual(["/profile", "/profile"]);
  watchers[0]!.emit_("notes.txt");
  await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
  expect(imports()).toHaveLength(2);
  // Some platforms omit the file name: the folder is checked anyway.
  watchers[0]!.emit_(null);
  await vi.advanceTimersByTimeAsync(WATCH_DEBOUNCE_MS);
  expect(imports()).toHaveLength(3);
  expect(onChange).toHaveBeenCalledTimes(3);
});

test("follows a new folder, stops without one and keeps one watch per folder", () => {
  startProfileWatch(onChange);
  syncProfileWatch();
  expect(watchers).toHaveLength(1);
  vi.mocked(sourcesConfig).mockReturnValue({ profileDir: "/other" } as never);
  syncProfileWatch();
  expect(watchers[0]!.close).toHaveBeenCalled();
  expect(watchers[1]!.dir).toBe("/other");
  vi.mocked(isFolder).mockReturnValue(false);
  vi.mocked(sourcesConfig).mockReturnValue({ profileDir: "" } as never);
  syncProfileWatch();
  expect(watchers[1]!.close).toHaveBeenCalled();
  expect(watchers).toHaveLength(2);
});

test("falls back to imports on read when the folder cannot be watched", () => {
  vi.mocked(fs.watch).mockImplementationOnce(() => { throw new Error("ENOSPC"); });
  startProfileWatch(onChange);
  expect(imports()).toEqual(["/profile"]);
  syncProfileWatch();
  expect(watchers).toHaveLength(1);
  watchers[0]!.emit("error", new Error("removed"));
  expect(watchers[0]!.close).toHaveBeenCalled();
});

test("reports an import in progress and survives a failing import", async () => {
  let finish: () => void = () => {};
  vi.mocked(importProfileAssets).mockReturnValueOnce(new Promise((_resolve, reject) => { finish = () => reject(new Error("database locked")); }));
  const running = importPending("/profile");
  expect(profileImporting()).toBe(true);
  finish();
  await running;
  expect(profileImporting()).toBe(false);
});
