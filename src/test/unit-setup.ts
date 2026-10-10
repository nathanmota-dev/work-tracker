import { afterEach, beforeEach, vi } from "vitest";

// Fail immediately if a unit test reaches an unconfigured I/O boundary.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const guarded = [
    "existsSync",
    "mkdirSync",
    "readFileSync",
    "writeFileSync",
    "unlinkSync",
    "cpSync",
    "readdirSync",
    "rmSync",
    "accessSync",
  ] as const;
  return {
    ...fs,
    ...Object.fromEntries(
      guarded.map((name) => [
        name,
        vi.fn(() => {
          throw new Error(`Unmocked file I/O: ${name}`);
        }),
      ]),
    ),
  };
});
vi.mock("node:sqlite", () => ({
  DatabaseSync: vi.fn(() => {
    throw new Error("Unmocked SQLite I/O");
  }),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(() => {
    throw new Error("Unmocked subprocess");
  }),
  spawnSync: vi.fn(() => {
    throw new Error("Unmocked subprocess");
  }),
}));
vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  createServer: vi.fn(() => {
    throw new Error("Unmocked HTTP server");
  }),
}));
import * as fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";

const noNetwork = () => {
  throw new Error("Unmocked network I/O");
};
beforeEach(() => {
  for (const name of [
    "existsSync",
    "mkdirSync",
    "readFileSync",
    "writeFileSync",
    "unlinkSync",
    "cpSync",
    "readdirSync",
    "rmSync",
    "accessSync",
  ] as const) {
    vi.mocked(fs[name])
      .mockReset()
      .mockImplementation(() => {
        throw new Error(`Unmocked file I/O: ${name}`);
      });
  }
  vi.mocked(DatabaseSync)
    .mockReset()
    .mockImplementation(() => {
      throw new Error("Unmocked SQLite I/O");
    });
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation(() => {
      throw new Error("Unmocked subprocess");
    });
  vi.mocked(spawnSync)
    .mockReset()
    .mockImplementation(() => {
      throw new Error("Unmocked subprocess");
    });
  vi.mocked(createServer)
    .mockReset()
    .mockImplementation(() => {
      throw new Error("Unmocked HTTP server");
    });
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw new Error("Unmocked process signal");
  });
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("Unmocked process exit");
  });
  vi.stubGlobal("fetch", vi.fn(noNetwork));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
