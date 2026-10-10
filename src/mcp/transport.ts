import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnOwned, stopOwned } from "../acp/process.ts";
/** MCP transport with a dedicated process group, including browser descendants. */
export class OwnedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ChildProcessWithoutNullStreams;
  private buffer = new ReadBuffer({ maxBufferSize: 4 * 1024 * 1024 });
  constructor(private options: { command: string; args: string[]; env: Record<string, string>; cwd: string }) {}
  async start(): Promise<void> {
    const p = spawnOwned(this.options.command, this.options.args, { env: this.options.env, cwd: this.options.cwd });
    this.child = p;
    p.stderr.resume();
    p.stdin.on("error", error => this.onerror?.(error));
    p.stdout.on("data", chunk => {
      try {
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch (error) { this.onerror?.(error as Error); void this.close(); }
    });
    p.once("close", () => { stopOwned(p); this.onclose?.(); });
    await new Promise<void>((resolve, reject) => {
      p.once("spawn", resolve);
      p.once("error", error => { this.onerror?.(error); reject(error); });
    });
  }
  async send(message: JSONRPCMessage): Promise<void> {
    const p = this.child;
    if (!p || p.stdin.destroyed) throw new Error("MCP process is not running");
    await new Promise<void>((resolve, reject) => p.stdin.write(serializeMessage(message), error => error ? reject(error) : resolve()));
  }
  async close(): Promise<void> {
    const p = this.child;
    this.child = undefined;
    if (!p) return;
    stopOwned(p);
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 500);
      p.once("close", () => { clearTimeout(timer); resolve(); });
    });
    this.buffer.clear();
  }
}
