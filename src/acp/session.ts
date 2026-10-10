import { AcpClient } from "./client.ts";
import { prepareWorkspace } from "../cli/skills.ts";
import { loadConfig } from "../paths.ts";

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
      return `Use the work-tracker-resume-tailor skill. Tailor my resume for these roles: ${
        params.jobIds ?? "(none provided)"
      }. Produce tailored Typst resumes, cover letters, and gap reports, and record each via \`work-tracker application add\`.`;
    case "outreach-tracker":
      return `Use the work-tracker-outreach-tracker skill. Review due actions, draft follow-ups, and request confirmation before sending. Record changes with work-tracker outreach.`;
    case "portal-filler":
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
export class SessionManager {
  private client: AcpClient | null = null;
  private running = false;

  constructor(
    private cwd: string,
    private sink: (event: unknown) => void,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async run(providerId: string, skill: string, params: Record<string, string>, model?: string): Promise<void> {
    if (this.running) {
      this.sink({ type: "acp-error", message: "A skill run is already in progress." });
      return;
    }
    this.running = true;
    const prompt = buildSkillPrompt(skill, withSavedProfile(params));

    this.client = new AcpClient(providerId, this.cwd, {
      onUpdate: (u) => this.sink({ type: "acp-update", update: u }),
      onLog: (line) => this.sink({ type: "acp-log", line }),
      onPermission: async (p) => {
        // The desktop UI has no permission prompt, so accept the agent's request.
        this.sink({ type: "acp-permission", params: p });
        const opts = (p as { options?: Array<{ optionId: string; kind?: string }> }).options ?? [];
        const allow = opts.find((o) => o.kind?.includes("allow")) ?? opts[0];
        return allow?.optionId ?? "allow";
      },
      onExit: (code) => {
        this.sink({ type: "acp-exit", code });
      },
    }, model);

    try {
      prepareWorkspace();
      this.sink({ type: "acp-status", status: "starting", provider: providerId, skill });
      await this.client.start();
      this.sink({ type: "acp-status", status: "running", skill });
      await this.client.prompt(prompt);
      this.sink({ type: "acp-status", status: "done", skill });
    } catch (e) {
      this.sink({ type: "acp-error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.running = false;
      this.client?.stop();
      this.client = null;
    }
  }

  stop(): void { this.client?.stop(); }

  cancel(): void {
    void this.client?.cancel().catch(() => {});
    this.client?.stop();
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
