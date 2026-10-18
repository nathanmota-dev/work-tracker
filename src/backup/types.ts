/** Backup contracts shared by the backend and the desktop interface. */

/** Workspace data intentionally left out, listed so restores are not mistaken for complete copies. */
export interface ExcludedSource {
  kind: "browser-session" | "agent-workspace" | "agent-credentials" | "backups" | "resume-source" | "symlink";
  path: string;
  reason: string;
}

/**
 * What the user reviews before restoring.
 *
 * @property fingerprint SHA-256 of the manifest; a restore must present the
 *   fingerprint it was shown so a backup changed after review is refused.
 */
export interface BackupSummary {
  path: string;
  fingerprint: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  counts: Record<string, number>;
  excluded: ExcludedSource[];
  files: number;
  artifacts: number;
  bytes: number;
}

/**
 * @property previous Folder under backups/ holding the replaced database,
 *   config and artifacts, kept so the restore can be undone by hand.
 */
export interface RestoreResult {
  restored: BackupSummary;
  previous: string;
}

