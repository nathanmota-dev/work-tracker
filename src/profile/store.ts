import { db, now } from "../db/index.ts";
import { PARSER_VERSION } from "./linkedin/parse.ts";
import type { ChoiceSource, ImportKind, LinkedInProfile, ProfileImport } from "./types.ts";

type ImportRow = { pdf_hash: string; kind: ImportKind; file_name: string; parser_version: number; extracted_json: string | null; text: string; warnings_json: string };
const record = (row: ImportRow): ProfileImport => ({
  hash: row.pdf_hash, kind: row.kind, file: row.file_name, parserVersion: row.parser_version,
  profile: row.extracted_json ? JSON.parse(row.extracted_json) as LinkedInProfile : null, text: row.text, warnings: JSON.parse(row.warnings_json) as string[],
});

/** Valid imports of these hashes: an extraction by another parser version counts as missing. */
export function cachedImports(hashes: string[]): Map<string, ProfileImport> {
  if (!hashes.length) return new Map();
  const rows = db().query(`SELECT * FROM profile_imports WHERE parser_version = ? AND pdf_hash IN (${hashes.map(() => "?").join(", ")})`).all(PARSER_VERSION, ...hashes) as ImportRow[];
  return new Map(rows.map(row => [row.pdf_hash, record(row)]));
}
export function saveImport(value: Omit<ProfileImport, "parserVersion">): void {
  db().query(`INSERT INTO profile_imports (pdf_hash, kind, file_name, parser_version, extracted_json, text, warnings_json, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pdf_hash) DO UPDATE SET kind = excluded.kind, file_name = excluded.file_name, parser_version = excluded.parser_version, extracted_json = excluded.extracted_json, text = excluded.text, warnings_json = excluded.warnings_json, imported_at = excluded.imported_at`)
    .run(value.hash, value.kind, value.file, PARSER_VERSION, value.profile ? JSON.stringify(value.profile) : null, value.text, JSON.stringify(value.warnings), now());
}

/** Decided sources by conflict key. */
export function profileChoices(): Map<string, ChoiceSource> {
  const rows = db().query("SELECT conflict_key, chosen_source FROM profile_choices").all() as { conflict_key: string; chosen_source: ChoiceSource }[];
  return new Map(rows.map(row => [row.conflict_key, row.chosen_source]));
}
/** Record the chosen source and its value; null forgets the decision ("Decide later"). */
export function saveChoice(key: string, choice: { field: string; source: ChoiceSource; value: string } | null): void {
  if (!choice) { db().query("DELETE FROM profile_choices WHERE conflict_key = ?").run(key); return; }
  db().query(`INSERT INTO profile_choices (conflict_key, field, chosen_source, chosen_value, decided_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conflict_key) DO UPDATE SET chosen_source = excluded.chosen_source, chosen_value = excluded.chosen_value, decided_at = excluded.decided_at`)
    .run(key, choice.field, choice.source, choice.value, now());
}
