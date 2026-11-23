import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { NOT_CHECKED, parseGuard } from "../postings/description.ts";

/** Everything the interview-prep skill needs to know about one application. */
export interface ApplicationContext {
  id: number;
  company: string | null;
  role: string | null;
  status: string | null;
  stage: string | null;
  location: string | null;
  work_type: string | null;
  comp: string | null;
  link: string | null;
  external_url: string | null;
  description: string | null;
  requirements: unknown;
  fit: string | null;
  resume_path: string | null;
  cover_letter_path: string | null;
  report_path: string | null;
  notes: string | null;
  submitted_at: string | null;
  /** Verdict of the posting guard on the job description; "Not checked" before the guard. */
  guard: { verdict: string; flagged: boolean };
}

/** The application with its linked job, or null when the id is unknown. */
export function applicationContext(id: number, d: Database = db()): ApplicationContext | null {
  const row = d.query(`
    SELECT a.id, COALESCE(a.company_name, j.company_name) AS company,
           COALESCE(a.role_title, j.title) AS role, a.status, s.name AS stage,
           j.location, j.work_type, COALESCE(a.comp, j.comp) AS comp, j.link, a.external_url,
           j.description, j.requirements_json, j.fit, a.resume_path, a.cover_letter_path,
           a.report_path, a.notes, a.submitted_at, j.description_guard_json
    FROM applications a
    LEFT JOIN jobs j ON j.id = a.job_id
    LEFT JOIN application_stages s ON s.id = a.current_stage_id
    WHERE a.id = ?
  `).get(id) as (Omit<ApplicationContext, "requirements" | "guard"> & { requirements_json: string | null; description_guard_json: string | null }) | undefined;
  if (!row) return null;
  const { requirements_json, description_guard_json, ...rest } = row;
  const guard = parseGuard(description_guard_json);
  return { ...rest, requirements: parseJson(requirements_json), guard: { verdict: guard?.verdict ?? NOT_CHECKED, flagged: guard?.flagged ?? false } };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
