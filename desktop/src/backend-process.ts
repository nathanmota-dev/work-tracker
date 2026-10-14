import { startBackend } from "../../src/server/index";
const startup = startBackend();
let stopping = false;
let shutdownTask: Promise<void> | undefined;
function shutdown(): Promise<void> {
  stopping = true;
  return shutdownTask ??= (async () => {
    const backend = await startup;
    await backend.close();
    // Stay alive until the main process acknowledges delivery of this message.
    process.parentPort.postMessage({ type: "stopped" });
  })();
}
process.parentPort.on("message", ({ data }) => {
  if (data?.type === "shutdown") void shutdown();
  if (data?.type === "exit" && stopping) process.exit(0);
});
void startup.then(async backend => {
  if (stopping) { await shutdown(); return; }
  process.parentPort.postMessage({ type: "ready", address: backend.address, port: backend.port, token: backend.token });
}).catch(error => {
  process.parentPort.postMessage({ type: "failed", message: String(error) });
  process.exit(1);
});
