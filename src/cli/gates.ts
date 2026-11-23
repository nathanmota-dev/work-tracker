import { readFileSync } from "node:fs";
import { notifyChange } from "../db/notify.ts";
import { languageKey } from "../gates/evaluate.ts";
import { gateProfile, removeLanguage, saveLanguage, setEligibility } from "../gates/profile-store.ts";
import { jobGate, saveGate } from "../gates/store.ts";
import { GateError, type GateProfile } from "../gates/types.ts";
import { type Flags, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function known(error: unknown): string {
  if (error instanceof GateError || (error as NodeJS.ErrnoException).code === "ENOENT") return (error as Error).message;
  if (error instanceof SyntaxError) return `the extraction file is not valid JSON: ${error.message}`;
  return String(error);
}

async function changed(table: string, profile: GateProfile): Promise<void> {
  await notifyChange(table);
  await notifyChange("jobs");
  console.log(JSON.stringify(profile, null, 2));
}

async function saveLanguageCmd(flags: Flags): Promise<void> {
  const language = str(flags, "language");
  // Saving a declared name updates its level instead of adding a duplicate.
  const existing = language ? gateProfile().languages.find((item) => languageKey(item.language) === languageKey(language)) : undefined;
  await changed("candidate_languages", saveLanguage({ id: existing?.id, language, level: str(flags, "level"), notes: str(flags, "notes") }));
}

function route(area: string | undefined, action: string | undefined, flags: Flags): (() => Promise<void> | void) | undefined {
  if (area === "profile") return () => console.log(JSON.stringify(gateProfile(), null, 2));
  if (area === "language" && action === "save") return () => saveLanguageCmd(flags);
  if (area === "language" && action === "remove") return () => changed("candidate_languages", removeLanguage({ language: str(flags, "language") }));
  if (area === "eligibility" && action === "set") return () => changed("gate_profile", setEligibility(str(flags, "status")));
  return undefined;
}

/** work-tracker gates profile | language save|remove | eligibility set */
export async function gatesCmd([area, action]: string[], flags: Flags): Promise<void> {
  const run = route(area, action, flags);
  if (!run) fail(`unknown gates subcommand: ${[area, action].filter(Boolean).join(" ")} (use profile, language save|remove or eligibility set)`);
  try {
    await run();
  } catch (error) {
    fail(known(error));
  }
}

/**
 * work-tracker job gate --id <n> [--file extraction.json]: store the skill's
 * extraction and print the verdict, or print the stored check without --file.
 */
export async function jobGateCmd(flags: Flags): Promise<void> {
  const id = str(flags, "id");
  if (!id || !/^[1-9]\d*$/.test(id)) fail("Expected a positive job id (--id).");
  const file = str(flags, "file");
  try {
    if (!file) {
      const gate = jobGate(Number(id));
      console.log(JSON.stringify(gate ?? { verdict: "unchecked" }, null, 2));
      return;
    }
    const gate = saveGate(Number(id), JSON.parse(readFileSync(file, "utf8")));
    await notifyChange("jobs");
    console.log(`job #${id} requirements: ${gate.verdict}${gate.unverified ? " (unverified)" : ""}`);
    console.log(JSON.stringify({ verdict: gate.verdict, unverified: gate.unverified, language: gate.language, eligibility: gate.eligibility }, null, 2));
  } catch (error) {
    fail(known(error));
  }
}
