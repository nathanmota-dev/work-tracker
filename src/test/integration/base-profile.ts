import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A synthetic profile in the workspace's profile folder: the base resume is
 * generated from it, with `summary` as its only paragraph unless a test adds more.
 */
export function writeProfile(home: string, fields: Record<string, unknown> = {}): void {
  const dir = join(home, "profile");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "resume-data.json"), JSON.stringify({ name: "Jordan Sample", summary: "Generic project with React and Node.js.", ...fields }));
}
/** The generated LaTeX of the workspace's base resume. */
export const baseResumeFile = (home: string) => join(home, "resume", "resume.tex");
/** A fake agent's tailoring: the run's copy of the base resume with `from` replaced. */
export function tailorCopy(manifest: { project: string; mainFile: string }, from: string, to: string): void {
  const path = join(manifest.project, manifest.mainFile);
  writeFileSync(path, readFileSync(path, "utf8").replace(from, to));
}
