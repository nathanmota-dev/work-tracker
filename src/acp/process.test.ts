import { beforeEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { processDouble } from "../test/doubles.ts";
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(process, "kill").mockReturnValue(true);
});
test("owned processes are detached, terminate as groups and escalate for descendants after exit", async () => {
  const p = processDouble();
  vi.mocked(spawn).mockReturnValue(p.asChild);
  const { spawnOwned, stopAllOwned } = await import("./process.ts");
  expect(
    spawnOwned("agent", ["acp"], { cwd: "/private", env: { KEY: "value" } }),
  ).toBe(p.child);
  expect(spawn).toHaveBeenCalledWith("agent", ["acp"], {
    cwd: "/private",
    env: { KEY: "value" },
    stdio: "pipe",
    detached: true,
  });
  p.child.emit("close", 0);
  const stopped = stopAllOwned();
  expect(process.kill).toHaveBeenCalledWith(-p.child.pid, "SIGTERM");
  await vi.advanceTimersByTimeAsync(350);
  await stopped;
  expect(process.kill).toHaveBeenCalledWith(-p.child.pid, "SIGKILL");
  vi.mocked(process.kill).mockClear();
  await stopAllOwned();
  expect(process.kill).not.toHaveBeenCalled();
});
test("spawn failures leave no owned process and cleanup tolerates missing groups", async () => {
  const p = processDouble();
  vi.mocked(spawn).mockReturnValue(p.asChild);
  const { spawnOwned, stopOwned, stopAllOwned } = await import("./process.ts");
  spawnOwned("missing", []);
  p.child.emit("error", new Error("ENOENT"));
  await stopAllOwned();
  expect(process.kill).not.toHaveBeenCalled();
  vi.mocked(process.kill).mockImplementation(() => {
    throw new Error("ESRCH");
  });
  stopOwned(p.asChild);
  await vi.advanceTimersByTimeAsync(300);
});
test("capture collects stdout and returns null on a bad exit, executable error or timeout", async () => {
  const { capture, stopAllOwned } = await import("./process.ts");
  for (const mode of ["success", "bad-exit", "error", "timeout"]) {
    const p = processDouble();
    vi.mocked(spawn).mockReturnValue(p.asChild);
    const outcome = capture("probe", [], 80);
    p.child.stdout.emit("data", "first");
    p.child.stdout.emit("data", " second");
    if (mode === "error") p.child.emit("error", new Error("missing"));
    else if (mode === "timeout") await vi.advanceTimersByTimeAsync(80);
    else p.child.emit("close", mode === "success" ? 0 : 1);
    expect(await outcome).toBe(mode === "success" ? "first second" : null);
    const stopping = stopAllOwned();
    await vi.advanceTimersByTimeAsync(350);
    await stopping;
  }
  expect(vi.getTimerCount()).toBe(0);
});
test("oversized capture stops the process and handles processes without a pid", async () => {
  const p = processDouble();
  Object.assign(p.child, { pid: undefined });
  vi.mocked(spawn).mockReturnValue(p.asChild);
  const { capture, stopAllOwned } = await import("./process.ts");
  const outcome = capture("probe", [], 80);
  p.child.stdout.emit("data", "x".repeat(4000001));
  expect(p.child.kill).toHaveBeenCalled();
  p.child.emit("close", 1);
  expect(await outcome).toBeNull();
  const stopping = stopAllOwned();
  await vi.advanceTimersByTimeAsync(350);
  await stopping;
  expect(p.child.kill).toHaveBeenCalledWith("SIGKILL");
});
