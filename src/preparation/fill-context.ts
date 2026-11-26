import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../paths.ts";
import { snapshotSources } from "./sources.ts";
import type { DocumentVersion } from "./types.ts";

/**
 * Everything the portal agent may rely on to draft an answer about the
 * candidate. The job posting is deliberately absent: it is third-party text.
 *
 * @property resume Text of the approved PDF.
 * @property profile Profile saved with that version, or the current one.
 * @property experience Entries of the experience bank.
 */
export interface FillContext {
  resume: string;
  profile: unknown;
  experience: { file: string; text: string }[];
}

/** A base or imported resume saves no profile; the current sources may not be readable. */
function currentProfile(): unknown {
  try { return snapshotSources().data; } catch { return null; }
}

function experienceBank(): FillContext["experience"] {
  const directory = join(paths.home, "experience");
  try {
    return readdirSync(directory).filter(file => file.endsWith(".md") && file !== "index.md").sort()
      .map(file => ({ file, text: readFileSync(join(directory, file), "utf8") }));
  } catch { return []; }
}

/** Write the evidence of one portal fill next to its manifest. */
export function writeFillContext(version: Pick<DocumentVersion, "text" | "data">, path: string): void {
  const context: FillContext = { resume: version.text, profile: version.data ?? currentProfile(), experience: experienceBank() };
  writeFileSync(path, JSON.stringify(context, null, 2), { mode: 0o600 });
}
