import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "work-tracker-ats-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
let database: typeof import("../../db/index.ts");
let ats: typeof import("../../ats/store.ts");
beforeAll(async () => {
  database = await import("../../db/index.ts");
  ats = await import("../../ats/store.ts");
});
afterAll(() => {
  database.closeDb();
  if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

function variant(id: string, name: string, text: string) {
  const d = database.db();
  d.query("INSERT INTO pdf_artifacts (id, run_id, kind, path, pages, text, warnings_json) VALUES (?, NULL, 'variant', ?, 1, ?, '[]')").run(`pdf-${id}`, join(home, `${id}.pdf`), text);
  d.query("INSERT INTO resume_variants (id, name, role, origin, status, pdf_artifact_id, created_at, updated_at) VALUES (?, ?, 'backend', 'imported', 'ready', ?, 'now', 'now')").run(id, name, `pdf-${id}`);
}

test("scores a real workspace on read, picks the right variant and follows description edits and archiving", () => {
  const d = database.db();
  const insert = d.query("INSERT INTO jobs (title, company_name, description) VALUES (?, 'Example Corp', ?) RETURNING id");
  const dotnet = (insert.get("C# Engineer", "Requirements:\n- C#\n- .NET\n- SQL Server\nNice to have: Docker") as { id: number }).id;
  const node = (insert.get("Node Engineer", "Requisitos: Node.js, TypeScript, PostgreSQL") as { id: number }).id;
  variant("n", "Back-End · Node.js", "Node.js, TypeScript, PostgreSQL and Docker services");
  variant("c", "Back-End · C#", "C#, .NET, ASP.NET Core and SQL Server APIs");
  const best = () => Object.fromEntries(ats.readBest(d, () => null).map(row => [row.job_id, [row.variant_id, row.score]]));
  expect(best()).toEqual({ [dotnet]: ["c", 90], [node]: ["n", 100] });
  expect(d.query("SELECT COUNT(*) AS n FROM ats_scores").get()).toEqual({ n: 4 });
  d.query("UPDATE jobs SET description = ? WHERE id = ?").run("Must have: Node.js, TypeScript and Docker", dotnet);
  expect(best()[dotnet]).toEqual(["n", 100]);
  d.exec("UPDATE resume_variants SET archived_at = 'now' WHERE id = 'n'");
  expect(best()).toEqual({ [dotnet]: ["c", 0], [node]: ["c", 0] });
  expect(d.query("SELECT DISTINCT document_key FROM ats_scores").all()).toEqual([{ document_key: "variant:c" }]);
  expect(ats.readJob(d, dotnet, () => null).documents[0]).toMatchObject({ requiredMissing: ["Node.js", "TypeScript", "Docker"] });
  d.query("DELETE FROM jobs WHERE id = ?").run(node);
  expect(d.query("SELECT COUNT(*) AS n FROM ats_scores WHERE job_id = ?").get(node)).toEqual({ n: 0 });
});
