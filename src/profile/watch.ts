import { watch, type FSWatcher } from "node:fs";
import { sourcesConfig } from "../preparation/sources.ts";
import { isFolder } from "./evidence.ts";
import { syncProfileAnswers } from "./autofill.ts";
import { importProfileAssets } from "./import.ts";

type Listener = () => void;
export const WATCH_DEBOUNCE_MS = 1000;

let watcher: FSWatcher | null = null;
let watched = "";
let timer: NodeJS.Timeout | undefined;
let importing = 0;
let changed: Listener = () => {};

/** True while files of the profile folder are being imported. */
export function profileImporting(): boolean { return importing > 0; }

/**
 * Import what the folder holds without a valid import, then announce the
 * change, filling empty answers from the sources. The cache by content hash is the import flag: a file imported once
 * is never extracted or confirmed again, even after the app restarts.
 */
export async function importPending(dir: string): Promise<void> {
  importing++;
  try { await importProfileAssets(dir); syncProfileAnswers(); }
  catch { /* each failure is recorded on its file; an unreadable folder shows in the state */ }
  finally { importing--; changed(); }
}

export function stopProfileWatch(): void {
  clearTimeout(timer);
  watcher?.close();
  watcher = null;
  watched = "";
}
/**
 * Follow the configured profile folder: import what is pending now, and again
 * whenever a PDF or the data file is added, replaced or removed there. Calling
 * it after the folder changes moves the watch to the new folder.
 */
export function syncProfileWatch(): void {
  const dir = sourcesConfig().profileDir;
  if (watcher && dir === watched) return;
  stopProfileWatch();
  if (!isFolder(dir)) return;
  watched = dir;
  try {
    watcher = watch(dir, { persistent: false }, (_event, name) => {
      if (name && !/\.(pdf|json)$/i.test(String(name))) return;
      clearTimeout(timer);
      timer = setTimeout(() => void importPending(dir), WATCH_DEBOUNCE_MS);
    });
    // A folder that disappears or cannot be watched falls back to imports on read.
    watcher.on("error", () => stopProfileWatch());
  } catch { watcher = null; }
  void importPending(dir);
}
/** Start following the profile folder; `onChange` runs after every import. */
export function startProfileWatch(onChange: Listener): void {
  changed = onChange;
  syncProfileWatch();
}
