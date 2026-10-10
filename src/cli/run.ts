import { parseFlags } from "./flags.ts";
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
  work-tracker job save [--linkedin-id --title --company --location --work-type --comp --fit --link --status]
  work-tracker metric record [--search-appearances --profile-views --post-impressions --connections --score]
  work-tracker score record --value <n> [--signals <json>]
  work-tracker interview add --company <c> [--when --stage --status --note]
  work-tracker application add [--job-id --resume-path --cover-path --report-path --keyword-score --status --portal --external-url]
  work-tracker application update --id <n> [--status --portal --external-url --fields --unfilled]
  work-tracker answer set --key <k> [--value --category]   Set a reusable application answer
  work-tracker answer list [--category <c>]                List reusable application answers
  work-tracker match --labels '["Email",...]' [--threshold-pct N]   Map ATS form labels to stored answers
  work-tracker detect-portal --url <application-url>       Identify the ATS + its known field selectors
  work-tracker export --typ <file> --out <file.pdf>        Compile a Typst doc to PDF
  work-tracker activity log [--kind --skill --summary --payload]

Options:
  -h, --help        Show this help
  -v, --version     Show version
`;

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

  switch (cmd) {
    case "fetch-profile": {
      const { fetchProfile } = await import("./fetch-profile.ts");
      await fetchProfile(positionals[0]);
      break;
    }
    case "doctor": {
      const { doctor } = await import("./doctor.ts");
      console.log(JSON.stringify(doctor(), null, 2));
      break;
    }
    case "serve":
    case "backend": {
      const { dashboardCmd } = await import("../server/index.ts");
      await dashboardCmd(flags);
      return;
    }
    case "init":
      initCmd();
      break;
    case "setup":
      await setupCmd(flags);
      break;
    case "dashboard": {
      const { dashboardCmd } = await import("../server/index.ts");
      await dashboardCmd(flags);
      return;
    }
    case "import-journey": {
      const file = positionals[0];
      if (!file) {
        console.error("error: usage: work-tracker import-journey <FILE.md>");
        process.exit(1);
      }
      await importJourneyCmd(file);
      break;
    }
    case "recruiter":
      await recruiterCmd(positionals[0] ?? "", flags);
      break;
    case "outreach": {
      const { outreachCmd } = await import("./outreach.ts");
      await outreachCmd(positionals[0] ?? "", flags);
      break;
    }
    case "job":
      await jobCmd(positionals[0] ?? "", flags);
      break;
    case "metric":
      await metricCmd(flags); // `record` subcommand is implicit
      break;
    case "score":
      await scoreCmd(flags);
      break;
    case "interview":
      await interviewCmd(positionals[0] ?? "", flags);
      break;
    case "application":
      await applicationCmd(positionals[0] ?? "", flags);
      break;
    case "answer":
      await answerCmd(positionals[0] ?? "", flags);
      break;
    case "match": {
      const { matchCmd } = await import("./match.ts");
      await matchCmd(flags);
      break;
    }
    case "detect-portal": {
      const { detectPortalCmd } = await import("./detect-portal.ts");
      await detectPortalCmd(flags);
      break;
    }
    case "export": {
      const { exportCmd } = await import("./export.ts");
      await exportCmd(flags);
      break;
    }
    case "activity":
      await activityCmd(flags);
      break;
    case "linkedin": {
      const { linkedinCmd } = await import("./linkedin.ts");
      await linkedinCmd(positionals[0] ?? "", flags);
      break;
    }
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }

  await closeMcp();
  closeDb();
}
