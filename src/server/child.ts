import type { Flags } from "../cli/flags.ts";
import { startBackend } from "./index.ts";

/**
 * Backend process supervised by `work-tracker start` over IPC: reports
 * `ready`/`failed`, asks to be stopped with `idle`, and shuts down on request.
 */
export async function backendChild(flags: Flags): Promise<void> {
  const send = (message: object) => process.send?.(message);
  let stopping = false;
  let shutdownTask: Promise<void> | undefined;
  const startup = startBackend(flags, { onIdle: () => send({ type: "idle" }) });
  const shutdown = () => {
    stopping = true;
    return shutdownTask ??= (async () => {
      await (await startup).close();
      // Stay alive until the launcher acknowledges delivery of this message.
      send({ type: "stopped" });
    })();
  };
  process.on("message", (data: { type?: string } | undefined) => {
    if (data?.type === "shutdown") void shutdown();
    if (data?.type === "exit" && stopping) process.exit(0);
  });
  // The launcher's signals reach the whole process group; it decides when to stop.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => void shutdown());
  try {
    const backend = await startup;
    if (stopping) return void (await shutdown());
    send({ type: "ready", address: backend.address, port: backend.port, token: backend.token });
  } catch (error) {
    send({ type: "failed", message: String(error) });
    process.exit(1);
  }
}
