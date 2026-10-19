import { text } from "node:stream/consumers";
import { listAnswerVariants } from "../answers/store.ts";
import { resolveAnswer } from "../answers/catalog.ts";
import { matchLabels } from "../match/matcher.ts";
import { str, int, type Flags } from "./flags.ts";

/**
 * work-tracker match --labels '["Email","Phone",...]' [--threshold 0.6]
 *
 * Reads the form labels a
 * skill scraped from a Chrome MCP snapshot, joins them against the stored
 * `applicant_answers`, and prints a JSON plan of what to fill vs. what to leave
 * for the human:
 *
 *   { "matched":  [{label, key, value, confidence, reason}],
 *     "unfilled": [{label, skip, key?}] }
 *
 * Labels may be passed via --labels (JSON array) or piped as JSON on stdin.
 * EEO/demographic fields are never placed in `matched` — they surface in
 * `unfilled` with skip "eeo-human-only".
 */
export async function matchCmd(flags: Flags): Promise<void> {
  let labels: string[];
  const inline = str(flags, "labels");
  if (inline) {
    labels = parseLabels(inline, "--labels");
  } else if (!process.stdin.isTTY) {
    const raw = await text(process.stdin);
    labels = parseLabels(raw.trim(), "stdin");
  } else {
    console.error(
      'error: provide labels via --labels \'["Email",...]\' or piped JSON on stdin',
    );
    process.exit(1);
  }

  const rows = listAnswerVariants();
  const answers: Record<string, string> = {};
  const resolutions: Record<string, Omit<ReturnType<typeof resolveAnswer>, "value">> = {};
  for (const key of new Set(rows.map((row) => row.key))) {
    const resolution = resolveAnswer(rows, key, str(flags, "language"), str(flags, "fallback-language"));
    const { value, ...provenance } = resolution;
    resolutions[key] = provenance;
    if (value !== undefined) answers[key] = value;
  }

  const threshold = int(flags, "threshold-pct");
  const result = matchLabels(labels, {
    answers,
    threshold: threshold !== undefined ? threshold / 100 : undefined,
  });

  console.log(JSON.stringify({ ...result, resolutions }, null, 2));
}

function parseLabels(raw: string, src: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`error: ${src} is not valid JSON`);
    process.exit(1);
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    console.error(`error: ${src} must be a JSON array of strings`);
    process.exit(1);
  }
  return parsed as string[];
}
