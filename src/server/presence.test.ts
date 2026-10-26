import { beforeEach, expect, test, vi } from "vitest";
import type { WebSocket } from "ws";
import { DISCONNECT_GRACE_MS, presence } from "./presence.ts";
const ws = () => ({}) as WebSocket;
let busy: boolean, onIdle: ReturnType<typeof vi.fn<() => void>>, disconnect: ReturnType<typeof vi.fn<() => void>>;
const tracker = (idleMs = 1000) => presence({ idleMs, busy: () => busy, onIdle, disconnect });
beforeEach(() => {
  vi.useFakeTimers();
  busy = false;
  onIdle = vi.fn<() => void>();
  disconnect = vi.fn<() => void>();
});

test("a reload within the grace period keeps a waiting permission prompt", async () => {
  const windows = tracker(0);
  const first = ws(), second = ws();
  windows.open(first);
  windows.close(first);
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS - 1);
  windows.open(second);
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
  expect(disconnect).not.toHaveBeenCalled();
  windows.close(second);
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
  expect(disconnect).toHaveBeenCalledOnce();
});

test("a permission request without windows disconnects only after the grace period", async () => {
  const windows = tracker(0);
  windows.permission();
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS - 1);
  expect(disconnect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(disconnect).toHaveBeenCalledOnce();
  const open = ws();
  windows.open(open);
  windows.permission();
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
  expect(disconnect).toHaveBeenCalledOnce();
});

test("reports idleness after the timeout without windows, waiting for active work", async () => {
  const windows = tracker();
  windows.start();
  busy = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(onIdle).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(onIdle).toHaveBeenCalledOnce();
});

test("an open window cancels the idle timer and its close starts a new one", async () => {
  const windows = tracker();
  windows.start();
  const open = ws(), other = ws();
  await vi.advanceTimersByTimeAsync(999);
  windows.open(open);
  windows.open(other);
  await vi.advanceTimersByTimeAsync(5000);
  windows.close(open);
  await vi.advanceTimersByTimeAsync(5000);
  expect(onIdle).not.toHaveBeenCalled();
  windows.close(other);
  await vi.advanceTimersByTimeAsync(1000);
  expect(onIdle).toHaveBeenCalledOnce();
});

test("a zero timeout or a missing callback never reports idleness, and stop clears the timers", async () => {
  tracker(0).start();
  presence({ idleMs: 1000, busy: () => false, disconnect }).start();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(onIdle).not.toHaveBeenCalled();
  const windows = tracker();
  windows.start();
  windows.permission();
  windows.stop();
  await vi.advanceTimersByTimeAsync(DISCONNECT_GRACE_MS);
  expect(onIdle).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
});
