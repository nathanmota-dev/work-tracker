import { AcpClient } from "./client.ts";
import { getProvider } from "./providers.ts";
import { prepareWorkspace } from "../cli/skills.ts";
import { loadConfig } from "../paths.ts";
import { randomUUID } from "node:crypto";
import { AgentPermissions } from "./permissions.ts";

/**
 * Builds templated prompts for each Work Tracker skill so the dashboard can launch
 * them with one click. The agent has the skills available and will persist
 * results via the `work-tracker` CLI.
 *
 * Any free-form `params.extra` (the Launch tab's "Additional context" field) is
 * appended as a clearly delimited block to EVERY skill's prompt so a single run
 * can be nudged without editing skills or code. When `extra` is empty the prompt
 * is byte-identical to the un-nudged template.
 */
export function buildSkillPrompt(skill: string, params: Record<string, string>): string {
  const base = baseSkillPrompt(skill, params);
  return appendExtra(base, params.extra);
}

/** The per-skill template, without any free-form additional-context block. */
function baseSkillPrompt(skill: string, params: Record<string, string>): string {
  switch (skill.replace(/^work-tracker-/, "")) {
    case "job-scout":
      return `Use the work-tracker-job-scout skill. Search LinkedIn for "${params.query ?? "software engineer"}"${
        params.location ? ` in ${params.location}` : ""
      }. Produce a prioritized shortlist with fit assessment and save each role with the \`work-tracker job save\` CLI.`;
    case "recruiter-outreach":
      return `Use the work-tracker-recruiter-outreach skill. Find technical recruiters at ${
        params.company ?? "the target companies"
      }${params.location ? ` who hire in ${params.location}` : ""}, prioritize them, and (with my confirmation) send connection requests. Record each via \`work-tracker recruiter add\`.`;
    case "profile-optimizer":
      return `Use the work-tracker-profile-optimizer skill. ${profileTarget(params)}Audit my LinkedIn profile, report ranked pitfalls, and record the metrics + score via \`work-tracker metric record\`.`;
    case "experience-bank":
      return `Use the work-tracker-experience-bank skill ("grill me"). Load my existing bank, base resume, and LinkedIn profile first, then interview me about new achievements I don't already have captured. Store tagged entries in \`$WORK_TRACKER_HOME/experience/\` and log the run via \`work-tracker activity log\`.`;
    case "resume-tailor":
      if (params.manifestPath) return `Use the work-tracker-resume-tailor skill in its managed LaTeX mode. Read the run manifest at ${JSON.stringify(params.manifestPath)}. Edit only the working project and produce its selection and report files. The backend owns compilation and persistence.`;
      return `Use the work-tracker-resume-tailor skill. Tailor my resume for these roles: ${
        params.jobIds ?? "(none provided)"
      }. Produce tailored Typst resumes, cover letters, and gap reports, and record each via \`work-tracker application add\`.`;
    case "outreach-tracker":
      return `Use the work-tracker-outreach-tracker skill. Review due actions, draft follow-ups, and request confirmation before sending. Record changes with work-tracker outreach.`;
    case "portal-filler":
      if (params.manifestPath) return `Use the work-tracker-portal-filler skill in its managed PDF mode. Read ${JSON.stringify(params.manifestPath)}. Use exactly the validated PDF identified there. Write the fill result to its resultPath, preserve the existing application ID, and stop for human review without clicking Submit.`;
      return `Use the work-tracker-portal-filler skill for ${params.url ?? params.jobIds ?? "the selected application"}. Fill the portal and stop for human review before submission.`;
    case "deep-scout":
      return `Use the work-tracker-job-scout skill to deeply assess this role for fit against my profile: ${params.query}. Save it via \`work-tracker job save\` with a fit rating.`;
    default:
      return params.prompt ?? skill;
  }
}

function profileTarget(params: Record<string, string>): string {
  const username = params.username?.trim();
  if (!username) return "";
  const url = `https://www.linkedin.com/in/${username}/`;
  return `My LinkedIn username is "${username}" and my profile URL is ${url}. Use \`get_person_profile(linkedin_username="${username}")\` for the profile pull. `;
}

/**
 * Append the user's one-off "Additional context" to a built prompt, clearly
 * delimited so the agent treats it as authoritative for this run. Returns the
 * prompt unchanged when `extra` is missing/blank (so empty input is a no-op).
 */
function appendExtra(prompt: string, extra: string | undefined): string {
  const trimmed = extra?.trim();
  if (!trimmed) return prompt;
  return `${prompt}\n\n---\nAdditional context from the user (honor this):\n${trimmed}`;
}

/**
 * Owns ACP sessions for the dashboard. One active client at a time (single
 * user). Forwards all agent updates to the provided sink (the WebSocket
 * broadcaster).
 */
export interface AcpRunResult { status: "done" | "cancelled" | "waiting_for_sign_in" | "error"; message?: string }

export class SessionManager {
  readonly permissions = new AgentPermissions(event => this.emit(event));
  private listeners = new Set<(event: Record<string, unknown>) => void>();
  private context: Record<string, string> = {};
  subscribe(listener: (event: Record<string, unknown>) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: Record<string, unknown>) { const value = { ...event, ...this.context }; this.sink(value); for (const listener of this.listeners) listener(value); }
  private client: AcpClient | null = null;
  private running = false;
  private cancelled = false;
  private clientKey = "";
  private waitingForSignIn = false;
  private tools = new Map<string, { title: string; output: string; status: string; context: Record<string, unknown> }>();
  private executionId = "";

  constructor(
    private cwd: string,
    private sink: (event: unknown) => void,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async run(providerId: string, skill: string, params: Record<string, string>, model?: string, effort?: string): Promise<AcpRunResult | void> {
    if (this.running) {
      this.emit({ type: "acp-error", message: "A skill run is already in progress." });
      return { status: "error", message: "A skill run is already in progress." };
    }
    this.context = params.runId ? { runId: params.runId, source: "apply" } : {};
    this.executionId = params.runId || randomUUID();
    this.permissions.setExecution({ runId: this.executionId, status: "starting" });
    this.running = true;
    this.cancelled = false;
    const prompt = buildSkillPrompt(skill, withSavedProfile(params));
    const config = loadConfig();
    const clientKey = JSON.stringify([providerId, model, effort, config.acp, config.mcp, config.linkedinMcpCommand]);
    if (this.client && this.clientKey !== clientKey) this.stop();
    const resuming = this.client !== null;

    if (!this.client) this.client = new AcpClient(providerId, this.cwd, {
      onUpdate: (u) => {
        if (this.client !== client) return;
        this.trackSignIn(u);
        this.emit({ type: "acp-update", update: u });
      },
      onLog: (line) => this.emit({ type: "acp-log", line }),
      onPermission: async (p): Promise<string | null> => {
        if (!client || this.client !== client || !this.running || !client.activeSessionId) return null;
        const request = p as { toolCall?: Record<string, unknown> } | null;
        // ACP v1 may supply only a toolCallId in a permission request.
        const call = request?.toolCall;
        const known = this.tools.get(String(call?.toolCallId))?.context;
        const params = call ? { ...request, toolCall: { ...known, ...Object.fromEntries(Object.entries(call).filter(([, value]) => value != null)) } } : p;
        return this.permissions.request(params, { runId: this.executionId, sessionId: client.activeSessionId, provider: providerId });
      },
      onExit: (code) => {
        if (this.client !== client) return;
        this.permissions.endSession();
        this.emit({ type: "acp-exit", code });
        if (!this.running) this.stop();
        this.waitingForSignIn = false;
        this.tools.clear();
      },
    }, model);
    const client: AcpClient | null = this.client;
    this.clientKey = clientKey;

    let completed = false;
    try {
      prepareWorkspace();
      this.emit({ type: "acp-status", status: "starting", provider: providerId, skill });
      if (!resuming) await client.start(effort ? { command: getProvider(providerId).command(this.cwd, model, effort) } : {});
      this.permissions.setExecution({ runId: this.executionId, sessionId: client.activeSessionId ?? undefined, status: "running" });
      this.emit({ type: "acp-status", status: "running", skill });
      await client.prompt(prompt);
      this.permissions.close("Turn ended");
      completed = true;
      const status = this.cancelled ? "cancelled" : this.waitingForSignIn ? "waiting_for_sign_in" : "done";
      this.permissions.setExecution({ runId: this.executionId, sessionId: client.activeSessionId ?? undefined, status });
      this.emit({ type: "acp-status", status, skill });
      return { status };
    } catch (e) {
      this.permissions.setExecution({ runId: this.executionId, status: this.cancelled ? "cancelled" : "error" });
      if (this.cancelled) this.emit({ type: "acp-status", status: "cancelled", skill });
      else this.emit({ type: "acp-error", message: e instanceof Error ? e.message : String(e) });
      return { status: this.cancelled ? "cancelled" : "error", message: e instanceof Error ? e.message : String(e) };
    } finally {
      this.running = false;
      // A pending-auth tool returns before the human finishes signing in. Keep
      // its ACP process and MCP/browser alive, and reuse them on the next run.
      if (!completed || !this.waitingForSignIn) this.stop();
    }
  }

  private trackSignIn(event: unknown): void {
    if (!event || typeof event !== "object") return;
    const outer = event as Record<string, unknown>;
    const value = (outer.update ?? outer) as Record<string, unknown>;
    if (!value || !["tool_call", "tool_call_update"].includes(String(value.sessionUpdate))) return;
    const key = String(value.toolCallId ?? value.title ?? "auth");
    const previous = this.tools.get(key);
    const tool = {
      context: { ...previous?.context, ...Object.fromEntries(Object.entries(value).filter(([, item]) => item != null)) },
      title: String(value.title ?? previous?.title ?? ""),
      status: String(value.status ?? previous?.status ?? ""),
      output: Array.isArray(value.content) ? value.content.map(item => item?.content?.type === "text" ? item.content.text : "").join("\n") : previous?.output ?? "",
    };
    this.tools.set(key, tool);
    if (tool.status !== "completed" && /\b(?:login (?:is still in|already in|in) progress|sign-in[^\n]*pending)\b/i.test(tool.output)) this.waitingForSignIn = true;
    else if (tool.status === "completed" && /linkedin|(?:get[ _](?:person|my)[ _]profile)/i.test(tool.title)) this.waitingForSignIn = false;
  }

  stop(): void {
    this.permissions.endSession();
    const client: AcpClient | null = this.client;
    this.client = null;
    this.waitingForSignIn = false;
    this.tools.clear();
    client?.stop();
  }

  cancel(): void {
    this.cancelled = true;
    this.permissions.setExecution({ runId: this.executionId, status: "cancelled" });
    this.permissions.close("Cancelled");
    void this.client?.cancel().catch(() => {});
    this.stop();
    if (!this.running) this.emit({ type: "acp-status", status: "cancelled" });
  }

  disconnect(): void {
    if (this.permissions.waiting) { this.permissions.close("Disconnected"); this.cancel(); }
  }
}

function withSavedProfile(params: Record<string, string>): Record<string, string> {
  const cfg = loadConfig();
  const username = params.username?.trim() || cfg.username?.trim();
  const displayName = params.displayName?.trim() || cfg.displayName?.trim();
  return {
    ...params,
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
  };
}
