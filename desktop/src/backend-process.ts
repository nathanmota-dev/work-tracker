import { startBackend } from "../../src/server/index";
let backend: Awaited<ReturnType<typeof startBackend>> | undefined;
let stopping = false;
async function shutdown() {
  stopping = true;
  await backend?.close();
  process.parentPort.postMessage({ type: "stopped" });
  process.exit(0);
}
process.parentPort.on("message", ({ data }) => {
  if (data?.type === "shutdown") void shutdown();
});
void startBackend().then(async handle => {
  backend = handle;
  if (stopping) { await shutdown(); return; }
  process.parentPort.postMessage({ type: "ready", address: handle.address, port: handle.port, token: handle.token });
}).catch(error => {
  process.parentPort.postMessage({ type: "failed", message: String(error) });
  process.exit(1);
});
