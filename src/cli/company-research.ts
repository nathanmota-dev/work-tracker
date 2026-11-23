import { readFileSync } from "node:fs";
import { notifyChange } from "../db/notify.ts";
import { CompanyResearchError } from "../company-research/sources.ts";
import { describeLookup, getCompanyResearch, listCompanyResearch, saveCompanyResearch } from "../company-research/store.ts";
import { type Flags, str } from "./flags.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readResearch(file: string): Record<string, unknown> {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); } catch (error) { fail((error as Error).message); }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* reported below */ }
  fail(`${file} must contain a JSON object with sources`);
}

function save(flags: Flags): void {
  const file = str(flags, "file");
  if (!file) fail("missing required --file (research JSON to cache)");
  const research = readResearch(file);
  const entry = saveCompanyResearch({
    company: str(flags, "company") ?? (typeof research.company === "string" ? research.company : ""),
    sources: research.sources,
    networkNote: research.network_contacts_note,
    summary: research.summary,
  });
  console.log(`company research for "${entry.company}" cached as ${entry.company_key}`);
}

/** work-tracker company-research get | save | list */
export async function companyResearchCmd(sub: string, flags: Flags): Promise<void> {
  try {
    if (sub === "list") {
      console.log(JSON.stringify(listCompanyResearch(), null, 2));
      return;
    }
    if (sub === "get") {
      const company = str(flags, "company") ?? "";
      console.log(JSON.stringify(describeLookup(company, getCompanyResearch(company, { allowStale: flags["allow-stale"] === true })), null, 2));
      return;
    }
    if (sub !== "save") fail(`unknown company-research subcommand: ${sub}`);
    save(flags);
  } catch (error) {
    if (error instanceof CompanyResearchError) fail(error.message);
    throw error;
  }
  await notifyChange("company_research");
}
