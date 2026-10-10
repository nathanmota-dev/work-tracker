import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Database } from "../db/sqlite.ts";
import { vi } from "vitest";

/** Scripted statement results; no SQL interpretation or persistence. */
export function databaseDouble() {
  const statement = {
    get: vi.fn<(...args: unknown[]) => unknown>(),
    all: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
  };
  const connection = {
    query: vi.fn((_sql: string) => statement),
    exec: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn(<A extends unknown[], T>(fn: (...args: A) => T) =>
      vi.fn(fn),
    ),
  };
  return {
    ...connection,
    statement,
    asDatabase: connection as unknown as Database,
  };
}

/** A stdio process whose events and writes are controlled entirely by the test. */
export function processDouble() {
  const stream = () =>
    Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
      resume: vi.fn(),
      destroyed: false,
      write: vi.fn((_data: unknown, cb?: (error?: Error) => void) => {
        cb?.();
        return true;
      }),
    });
  const child = Object.assign(new EventEmitter(), {
    pid: 123456,
    stdout: stream(),
    stderr: stream(),
    stdin: stream(),
    kill: vi.fn(),
  });
  return { child, asChild: child as unknown as ChildProcessWithoutNullStreams };
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function cliSpies() {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit:${code}`);
  });
  return { log, error, exit };
}
