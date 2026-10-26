import type { WebSocket } from "ws";

/** Time without any open window before an agent waiting for permission is told the user left. */
export const DISCONNECT_GRACE_MS = 15_000;

/**
 * Tracks the open windows of the web app. A reload or a closed tab briefly
 * leaves no socket, so only a lasting absence cancels a permission prompt.
 *
 * @param idleMs Time without windows before `onIdle`; 0 never reports idleness.
 * @param busy Work that must finish first; idleness is checked again later.
 * @param graceMs Time without windows before `disconnect`.
 */
export function presence({ idleMs, busy, onIdle, disconnect, graceMs = DISCONNECT_GRACE_MS }: {
  idleMs: number;
  graceMs?: number;
  busy: () => boolean;
  onIdle?: () => void;
  disconnect: () => void;
}) {
  const sockets = new Set<WebSocket>();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const disconnectLater = () => {
    clearTimeout(disconnectTimer);
    disconnectTimer = setTimeout(() => { if (!sockets.size) disconnect(); }, graceMs);
  };
  const scheduleIdle = () => {
    clearTimeout(idleTimer);
    if (!idleMs || !onIdle || sockets.size) return;
    idleTimer = setTimeout(() => {
      if (sockets.size) return;
      if (busy()) scheduleIdle();
      else onIdle();
    }, idleMs);
  };
  return {
    sockets,
    /** Start counting idleness once the server listens. */
    start: scheduleIdle,
    open(ws: WebSocket) {
      sockets.add(ws);
      clearTimeout(idleTimer);
    },
    close(ws: WebSocket) {
      sockets.delete(ws);
      if (sockets.size) return;
      disconnectLater();
      scheduleIdle();
    },
    /** An agent asked for permission; nobody can answer it without a window. */
    permission() {
      if (!sockets.size) disconnectLater();
    },
    stop() {
      clearTimeout(idleTimer);
      clearTimeout(disconnectTimer);
    },
  };
}
