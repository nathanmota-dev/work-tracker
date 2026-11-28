import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Central path resolution for Work Tracker.
 * Everything personal lives under ~/.work-tracker/ (overridable via WORK_TRACKER_HOME).
 */
export const WORK_TRACKER_HOME = resolve(process.env.WORK_TRACKER_HOME ?? join(homedir(), ".work-tracker"));

/**
 * @property serverLock Lockfile used by the CLI to notify the backend of database changes.
 * @property artifacts Default location for tailored resume artifacts.
 * @property backups Consistent database snapshots taken before incompatible migrations.
 */
export const paths = {
  home: WORK_TRACKER_HOME,
  db: join(WORK_TRACKER_HOME, "work-tracker.db"),
  config: join(WORK_TRACKER_HOME, "config.json"),
  serverLock: join(WORK_TRACKER_HOME, "backend.lock"),
  artifacts: join(WORK_TRACKER_HOME, "artifacts"),
  backups: join(WORK_TRACKER_HOME, "backups"),
  workspace: join(WORK_TRACKER_HOME, "workspace"),
  /** The profile's files: the resume data or LinkedIn export it is built from, and reference resume PDFs. */
  profile: join(WORK_TRACKER_HOME, "profile"),
  /** The base resume's LaTeX, generated from the profile on every change. */
  baseResume: join(WORK_TRACKER_HOME, "resume"),
  bin: join(WORK_TRACKER_HOME, "bin"),
  /** MCP servers, their runtimes and browsers installed by the app. */
  tools: join(WORK_TRACKER_HOME, "tools"),
  linkedinProfile: join(WORK_TRACKER_HOME, "browsers", "linkedin", "profile"),
  chromeProfile: join(WORK_TRACKER_HOME, "browsers", "chrome", "profile"),
};

/** Create the data directory, its default subdirectories, and an empty config. */
export function ensureHome(): void {
  for (const dir of [paths.home, paths.artifacts, paths.workspace, paths.bin]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(paths.config)) {
    try { writeFileSync(paths.config, "{}\n", { flag: "wx", mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
}

/**
 * @property [username] LinkedIn username for the active candidate profile.
 * @property [provider] Default ACP provider id.
 * @property [linkedinMcpCommand] Optional explicit LinkedIn MCP connection command.
 * @property [outreach] Outreach settings. Omitted fields fall back to DEFAULT_OUTREACH_CONFIG.
 */
export interface WorkTrackerConfig {
  username?: string;
  displayName?: string;
  provider?: "opencode" | "claude-code";
  linkedinMcpCommand?: string[];
  mcp?: Partial<Record<"linkedin" | "chrome", { command: string; args?: string[]; env?: Record<string, string> }>>;
  acp?: Partial<Record<"opencode" | "claude-code", { command: string; args?: string[]; env?: Record<string, string> }>>;
  outreach?: Partial<Omit<OutreachConfig, "inmail" | "invites">> & {
    inmail?: Partial<OutreachConfig["inmail"]>;
    invites?: Partial<OutreachConfig["invites"]>;
  };
}

/**
 * Outreach tracking configuration stored in config.json.
 *
 * @property inviteWithdrawDays Days after an invite with no accept before it's withdraw-eligible.
 * @property followupAfterDays Days after the first post-accept message with no reply before a nudge is due.
 * @property followupGraceDays Days after a nudge with no reply before marking unresponsive and blocking the company.
 * @property companyBlock Company-scoped block policy after a terminal, non-engaged outcome.
 * @property companyBlockCooldownMonths Cooldown length in months when companyBlock is "cooldown".
 * @property requireSendConsent Never auto-send; skills draft messages and ask for consent.
 * @property inmail.reserveFloor Never spend InMail credits below this floor.
 * @property invites.weeklyLimit Weekly connection-invite soft cap, separate from the InMail budget.
 */
export interface OutreachConfig {
  inviteWithdrawDays: number;
  followupAfterDays: number;
  followupGraceDays: number;
  companyBlock: "permanent" | "cooldown";
  companyBlockCooldownMonths: number;
  requireSendConsent: boolean;
  inmail: {
    plan: "career" | "business" | "recruiter_lite" | "sales_navigator" | "none";
    monthlyAllotment: number;
    rolloverCap: number;
    cycleResetDay: number;
    reserveFloor: number;
  };
  invites: {
    weeklyLimit: number;
  };
}

/** Default outreach policy, including a company-block cooldown. */
export const DEFAULT_OUTREACH_CONFIG: OutreachConfig = {
  inviteWithdrawDays: 7,
  followupAfterDays: 4,
  followupGraceDays: 7,
  companyBlock: "cooldown",
  companyBlockCooldownMonths: 9,
  requireSendConsent: true,
  inmail: {
    plan: "career",
    monthlyAllotment: 5,
    rolloverCap: 15,
    cycleResetDay: 1,
    reserveFloor: 1,
  },
  invites: {
    weeklyLimit: 100,
  },
};

export function loadConfig(): WorkTrackerConfig {
  if (!existsSync(paths.config)) return {};
  try {
    return JSON.parse(readFileSync(paths.config, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve the effective outreach config: saved values deep-merged over defaults
 * so the core lib always receives a complete, well-typed config object.
 */
export function loadOutreachConfig(): OutreachConfig {
  const saved = loadConfig().outreach ?? {};
  const d = DEFAULT_OUTREACH_CONFIG;
  return {
    ...d,
    ...saved,
    inmail: { ...d.inmail, ...(saved.inmail ?? {}) },
    invites: { ...d.invites, ...(saved.invites ?? {}) },
  };
}

export function saveConfig(cfg: WorkTrackerConfig): void {
  ensureHome();
  writeFileSync(paths.config, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
