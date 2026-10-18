import { readFileSync, writeFileSync } from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnOwned, stopOwned } from "./process.ts";
import { agentEnvironment } from "../cli/skills.ts";
import { acpMcpServers } from "../mcp/config.ts";
import { getProvider, type AcpProviderCommand } from "./providers.ts";

/**
 * Minimal Agent Client Protocol (ACP) client.
 *
 * ACP is newline-delimited JSON-RPC 2.0 over the agent's stdio. We act as the
 * *client* (editor side): we spawn the agent, run the initialize handshake,
 * create a session, send prompts, and receive streaming `session/update`
 * notifications. The agent may call back into us for fs access and permission.
 *
 * Spec: https://agentclientprotocol.com
 */

type Json = unknown;
interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Json;
  result?: Json;
  error?: { code: number; message: string; data?: Json };
}

/**
 * @property onUpdate Streaming update from the agent, such as text, tool calls, or plans.
 * @property onPermission Permission request handler; return the chosen option ID.
 * @property onLog Agent log or stderr line.
 * @property onExit Agent process exit notification.
 */
export interface AcpEvents {
  onUpdate?: (update: Json) => void;
  onPermission?: (params: Json) => Promise<string | null>;
  onLog?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

interface AcpStartOptions {
  command?: AcpProviderCommand;
  mcpServers?: ReturnType<typeof acpMcpServers>;
}

export class AcpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (v: Json) => void; reject: (e: Error) => void }
  >();
  private buf = "";
  private sessionId: string | null = null;
  private models: string[] = [];

  constructor(
    private providerId: string,
    private cwd: string,
    private events: AcpEvents = {},
    private model?: string,
    private requestTimeoutMs = 15000,
  ) {}

  get availableModels(): string[] { return [...this.models]; }
  get activeSessionId(): string | null { return this.sessionId; }

  /** Spawn the agent and run the initialize handshake + create a session. */
  async start(options: AcpStartOptions = {}): Promise<void> {
    const spawnOpts = options.command ?? getProvider(this.providerId).command(this.cwd, this.model);
    this.proc = spawnOwned(spawnOpts.cmd[0]!, spawnOpts.cmd.slice(1), {
      cwd: this.cwd, env: { ...agentEnvironment(), ...spawnOpts.env },
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (text: string) => {
      this.buf += text;
      if (this.buf.length > 4_000_000) { this.stop(); return; }
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) void this.handleLine(line).catch(error => this.failPending(error));
      }
    });
    this.proc.stderr.on("data", chunk => this.events.onLog?.(String(chunk)));
    this.proc.stdin.on("error", error => this.failPending(error));
    this.proc.once("error", error => this.failPending(new Error(`ACP executable failed: ${error.message}`)));
    this.proc.once("exit", code => {
      this.failPending(new Error(`ACP process exited (${code})`));
      this.events.onExit?.(code);
    });

    // 1) initialize — advertise our client capabilities
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });

    // 2) session/new — bound to the Work Tracker workspace cwd
    const session = (await this.request("session/new", {
      cwd: this.cwd,
      mcpServers: options.mcpServers ?? acpMcpServers(),
    })) as { sessionId: string; models?: { availableModels?: unknown } };
    if (!session || typeof session.sessionId !== "string") throw new Error("Invalid ACP session/new response");
    this.sessionId = session.sessionId;
    const available = session.models?.availableModels;
    this.models = Array.isArray(available) ? [...new Set(available
      .filter((model: unknown): model is { modelId: string } =>
        typeof model === "object" && model !== null && "modelId" in model &&
        typeof model.modelId === "string" && model.modelId.trim() !== "" && model.modelId !== "default")
      .map(model => model.modelId))] : [];
  }

  /** Send a prompt to the active session. Resolves when the turn ends. */
  async prompt(text: string): Promise<Json> {
    if (!this.sessionId) throw new Error("no active ACP session");
    return this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel(): Promise<void> {
    if (!this.sessionId) return;
    await this.notify("session/cancel", { sessionId: this.sessionId });
  }

  stop(): void {
    this.failPending(new Error("ACP session stopped"));
    if (this.proc) stopOwned(this.proc);
    this.proc = null;
    this.sessionId = null;
  }
  private failPending(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }


  private send(msg: RpcMessage): void {
    const line = JSON.stringify(msg) + "\n";
    if (!this.proc || this.proc.stdin.destroyed) throw new Error("ACP process is not running");
    this.proc.stdin.write(line);
  }

  private request(method: string, params: Json): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP timeout: ${method}`));
        this.stop();
      }, method === "session/prompt" ? 20 * 60 * 1000 : this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      try { this.send({ jsonrpc: "2.0", id, method, params }); }
      catch (error) { this.pending.get(id)?.reject(error as Error); this.pending.delete(id); }
    });
  }

  private notify(method: string, params: Json): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private async handleLine(line: string): Promise<void> {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      this.events.onLog?.(line);
      return;
    }

    // Response to one of our requests
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? null);
      }
      return;
    }

    // Request or notification FROM the agent
    if (msg.method) {
      await this.handleAgentCall(msg);
    }
  }

  private async handleAgentCall(msg: RpcMessage): Promise<void> {
    const { method, params, id } = msg;
    const respond = (result: Json) =>
      id !== undefined && this.send({ jsonrpc: "2.0", id, result });
    const fail = (message: string) =>
      id !== undefined &&
      this.send({ jsonrpc: "2.0", id, error: { code: -32000, message } });

    switch (method) {
      case "session/update":
        this.events.onUpdate?.(params);
        respond(null);
        break;

      case "session/request_permission": {
        try {
          const request = params as { sessionId?: unknown; options?: { optionId: string }[] } | null;
          const sessionId = this.sessionId;
          const optionId = request?.sessionId === sessionId && sessionId && this.events.onPermission
            ? await this.events.onPermission(params) : null;
          if (this.sessionId !== sessionId || !this.proc || this.proc.stdin.destroyed) break;
          const valid = optionId !== null && request?.options?.some(o => o.optionId === optionId);
          respond({ outcome: valid ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
        break;
      }

      case "fs/read_text_file": {
        try {
          const p = params as { path: string };
          respond({ content: readFileSync(p.path, "utf8") });
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
        break;
      }

      case "fs/write_text_file": {
        try {
          const p = params as { path: string; content: string };
          writeFileSync(p.path, p.content);
          respond(null);
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
        break;
      }

      default:
        // Unknown notification — ignore; unknown request — null result.
        if (id !== undefined) respond(null);
    }
  }
}
