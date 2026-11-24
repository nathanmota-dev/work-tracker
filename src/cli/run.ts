import { parseFlags, type Flags } from "./flags.ts";
import { initCmd } from "./init.ts";
import { setupCmd } from "./setup.ts";
import { recruiterCmd } from "./recruiter.ts";
import {
  jobCmd,
  metricCmd,
  scoreCmd,
  interviewCmd,
  applicationCmd,
  answerCmd,
  activityCmd,
} from "./records.ts";
import { importJourneyCmd } from "./import-journey.ts";
import { VERSION } from "../version.gen.ts";
import { closeDb } from "../db/index.ts";
import { closeMcp } from "../mcp/linkedin.ts";

const HELP = `work-tracker — AI-powered job search companion

Usage:
  work-tracker setup                  Install bundled skills in the private workspace
  work-tracker init                       Scaffold ~/.work-tracker/ + database
  work-tracker doctor                 Diagnose local optional dependencies
  work-tracker linkedin reset             Clear stale LinkedIn MCP browser sessions + locks
  work-tracker serve [--port N]       Start the local backend
  work-tracker fetch-profile [username]  Fetch a LinkedIn profile
  work-tracker import-journey <FILE.md>   Migrate a legacy JOURNEY.md into the db
  work-tracker profile sources        Print the profile folder's files, import status and conflicts as JSON
  work-tracker profile import [--force]   Extract the folder's LinkedIn export and reference PDFs (--force: all again)
  work-tracker variant list [--archived]  Print the saved resumes (role, stacks, status, PDF and stale flag) as JSON

Write API (used by skills):
  work-tracker recruiter add --name <n> [--company --username --title --location --degree --status --note]
  work-tracker recruiter update --id <n> [--status --note --username --company --title --location --degree]
  work-tracker recruiter sync [--apply] [--json]                Detect accepted invites (1st-degree) → mark accepted
  work-tracker outreach log --username <u> --company-urn <n> [--name --company --channel --state --cost --source-skill]
  work-tracker outreach check --username <u> --company-urn <n>   Blacklist check (exit 1 if blocked)
  work-tracker outreach update --id <n> --state <s> [--reason]   Transition lifecycle state
  work-tracker outreach due [--on YYYY-MM-DD]                    List due follow-up/withdraw/close actions
  work-tracker outreach list [--company-urn <n>] [--state <s>]   List attempts
  work-tracker outreach blocked --company-urn <n>                List people blocked for a company
  work-tracker outreach budget [set: --plan --remaining --allotment --rollover-cap --reserve-floor]
  work-tracker outreach withdraw --id <n>                        Withdraw pending invite (browser) + block
  work-tracker job save --title <t> --company <c> [--linkedin-id --source --source-id --location --work-type --comp --fit --link --status --requirements --description --deadline YYYY-MM-DD]
  work-tracker job update --id <n> [same job fields]
  work-tracker job list                     List jobs, including archived_at, guard_verdict, gate_verdict, ranking_status and ranking_overall
  work-tracker job gate --id <n> [--file <extraction.json>]
      Store the requirements-check extraction and print the pass/flag/fail verdict; without --file, print the stored check
  work-tracker gates profile                Print declared languages and work eligibility as JSON
  work-tracker gates language save --language <name> --level <level> [--notes]   Declare a language (updates it by name)
  work-tracker gates language remove --language <name>
  work-tracker gates eligibility set --status <citizen_or_resident|needs_permission|none>   none turns the gate off
  work-tracker metric record [--search-appearances --profile-views --post-impressions --connections --score]
  work-tracker score record --value <n> [--signals <json>]
  work-tracker interview add --company <c> [--when --stage --status --note]
  work-tracker application add [--job-id <local> | --linkedin-job-id <external>] [--new-attempt --idempotency-key
      --resume-path --cover-path --report-path --keyword-score --status --portal --external-url]
      Reuses the job's latest application; --new-attempt explicitly applies again after a submission
  work-tracker application update --id <n> [--status --portal --external-url --fields --unfilled]
  work-tracker application show --id <n>                        Print the application, its job and submitted documents as JSON
  work-tracker application quiet [--days N]                     List submitted applications without activity for N days (default 60, min 7) as JSON
  work-tracker interview-prep save --application-id <n> --stage <s> --file <pack.md> [--when --format --interviewers]
      Store an interview preparation pack (Markdown); earlier packs of the stage stay as history
  work-tracker interview-prep list [--application-id <n>]       List stored packs
  work-tracker followup save --application-id <n> --kind <follow_up|thank_you> --channel <email|linkedin|portal> --file <body.md>
      [--subject <s> --stage-event <n>]   Store a 60-120 word draft for the user to send; refused after 2 sent follow-ups
  work-tracker followup list [--application-id <n>]             List drafts and sent messages as JSON
  work-tracker followup candidates [--days N]                   List follow-ups (default 10 days quiet) and thank-you notes due as JSON
  work-tracker ranking candidates [--limit N] [--all] [--job-ids 1,2]
      Jobs to triage as JSON (default 10; unranked and unreachable only unless --all), with deferred and expired counts
  work-tracker ranking save --job-id <n> --file <result.json>   Store one posting's triage result (scored | expired | unreachable)
  work-tracker ranking list                                     List triage rankings, expiry derived from deadlines, as JSON
  work-tracker company-research get --company <name> [--allow-stale]
      Cached company research as JSON with fresh and age_days; stale notes are withheld unless --allow-stale
  work-tracker company-research save --company <name> --file <research.json>   Cache research (replaces the company's entry)
  work-tracker company-research list                            List cached companies with their age
  work-tracker application review                   List legacy applications that need reconciliation
  work-tracker application reconcile                Apply safe fixes; ambiguous records keep their flag
  work-tracker application resolve --id <n> --decision <track|mark_submitted|mark_not_submitted|keep_attempt>
      [--company --external-url --applied-at]      Decide one flagged record explicitly
  work-tracker application link --id <n> (--job-id <local> | --linkedin-job-id <external> | --create
      [--title --company --external-url --comp --description])   Link or create the job of an application
  work-tracker answer set --key <k> [--value --category --language]   Set a reusable application answer
  work-tracker answer list [--category <c> --language <tag>]                List reusable application answers
  work-tracker answer delete --key <k> [--language]       Delete an answer version
  work-tracker match --labels '["Email",...]' [--threshold-pct N --language --fallback-language]   Map ATS form labels to stored answers
  work-tracker detect-portal --url <application-url>       Identify the ATS + its known field selectors
  work-tracker export --typ <file> --out <file.pdf>        Compile a Typst doc to PDF
  work-tracker activity log [--kind --skill --summary --payload]

Options:
  -h, --help        Show this help
  -v, --version     Show version
`;

/** Returns true when the command keeps running and must not close resources. */
type Command = (positionals: string[], flags: Flags) => Promise<boolean | void> | boolean | void;

async function serveCmd(_positionals: string[], flags: Flags): Promise<boolean> {
  const { dashboardCmd } = await import("../server/index.ts");
  await dashboardCmd(flags);
  return true;
}

const commands: Record<string, Command> = {
  "fetch-profile": async ([username]) => {
    const { fetchProfile } = await import("./fetch-profile.ts");
    await fetchProfile(username);
  },
  doctor: async () => {
    const { doctor } = await import("./doctor.ts");
    console.log(JSON.stringify(doctor(), null, 2));
  },
  serve: serveCmd,
  backend: serveCmd,
  dashboard: serveCmd,
  init: () => initCmd(),
  setup: (_positionals, flags) => setupCmd(flags),
  "import-journey": async ([file]) => {
    if (!file) {
      console.error("error: usage: work-tracker import-journey <FILE.md>");
      process.exit(1);
    }
    await importJourneyCmd(file);
  },
  profile: async ([sub], flags) => {
    const { profileCmd } = await import("./profile-sources.ts");
    await profileCmd(sub ?? "", flags);
  },
  variant: async ([sub], flags) => {
    const { variantCmd } = await import("./variants.ts");
    variantCmd(sub ?? "", flags);
  },
  recruiter: ([sub], flags) => recruiterCmd(sub ?? "", flags),
  outreach: async ([sub], flags) => {
    const { outreachCmd } = await import("./outreach.ts");
    await outreachCmd(sub ?? "", flags);
  },
  job: ([sub], flags) => jobCmd(sub ?? "", flags),
  metric: (_positionals, flags) => metricCmd(flags), // `record` subcommand is implicit
  score: (_positionals, flags) => scoreCmd(flags),
  interview: ([sub], flags) => interviewCmd(sub ?? "", flags),
  application: ([sub], flags) => applicationCmd(sub ?? "", flags),
  "interview-prep": async ([sub], flags) => {
    const { interviewPrepCmd } = await import("./interview-prep.ts");
    await interviewPrepCmd(sub ?? "", flags);
  },
  followup: async ([sub], flags) => {
    const { followupCmd } = await import("./followup.ts");
    await followupCmd(sub ?? "", flags);
  },
  ranking: async ([sub], flags) => {
    const { rankingCmd } = await import("./rankings.ts");
    await rankingCmd(sub ?? "", flags);
  },
  gates: async (positionals, flags) => {
    const { gatesCmd } = await import("./gates.ts");
    await gatesCmd(positionals, flags);
  },
  "company-research": async ([sub], flags) => {
    const { companyResearchCmd } = await import("./company-research.ts");
    await companyResearchCmd(sub ?? "", flags);
  },
  answer: ([sub], flags) => answerCmd(sub ?? "", flags),
  match: async (_positionals, flags) => {
    const { matchCmd } = await import("./match.ts");
    await matchCmd(flags);
  },
  "detect-portal": async (_positionals, flags) => {
    const { detectPortalCmd } = await import("./detect-portal.ts");
    await detectPortalCmd(flags);
  },
  export: async (_positionals, flags) => {
    const { exportCmd } = await import("./export.ts");
    await exportCmd(flags);
  },
  activity: (_positionals, flags) => activityCmd(flags),
  linkedin: async ([sub], flags) => {
    const { linkedinCmd } = await import("./linkedin.ts");
    await linkedinCmd(sub ?? "", flags);
  },
};

export async function runCli(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    return;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(`work-tracker ${VERSION}`);
    return;
  }
  const { positionals, flags } = parseFlags(rest);
  const command = Object.hasOwn(commands, cmd) ? commands[cmd] : undefined;
  if (!command) {
    console.error(`unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }
  if (command && (await command(positionals, flags))) return;

  await closeMcp();
  closeDb();
}
