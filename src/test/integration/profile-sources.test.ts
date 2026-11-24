import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
vi.mock("../../mcp/chrome.ts", () => ({ openChromePortal: vi.fn(async () => {}) }));
const home = mkdtempSync(join(tmpdir(), "work-tracker-profile-"));
const previousHome = process.env.WORK_TRACKER_HOME;
process.env.WORK_TRACKER_HOME = home;
const project = join(home, "latex");
const profileDir = join(home, "profile");
const dataFile = join(profileDir, "resume-data.json");
let database: typeof import("../../db/index.ts");
let sources: typeof import("../../preparation/sources.ts");
let service: import("../../preparation/service.ts").PreparationService;
const manifests: Record<string, unknown>[] = [];
let jobId: number;
const call = async (path: string, body: unknown) => {
  const { handleProfileSources } = await import("../../profile/http.ts");
  return (await handleProfileSources(path, new Request("http://local", { method: "POST", body: JSON.stringify(body) }), () => {})).json() as Promise<import("../../profile/types.ts").ProfileSourcesState>;
};
async function complete(id: string) {
  for (let i = 0; i < 300; i++) { const run = service.details({ jobId }).runs.find(r => r.id === id)!; if (run.status !== "running") return run; await new Promise(r => setTimeout(r, 100)); }
  throw new Error("Execution did not finish");
}
beforeAll(async () => {
  mkdirSync(project);
  mkdirSync(profileDir);
  writeFileSync(join(project, "resume.tex"), "\\documentclass{article}\n\\begin{document}\nGeneric resume.\n\\end{document}\n");
  copyFileSync(resolve("src/test/fixtures/profile/linkedin-export.pdf"), join(profileDir, "linkedin-export.pdf"));
  writeFileSync(join(profileDir, "broken.pdf"), "%PDF-1.4 not really a PDF");
  writeFileSync(dataFile, JSON.stringify({ work: [{ company: "Northwind Labs", start: "2022-11", end: "Present" }, { company: "Fabrikam Studio", start: "2017", end: "2019-05" }], skills: ["React"] }));
  const { compileLatex } = await import("../../preparation/latex.ts");
  for (const [name, text] of [["backend-resume", "Jordan Sample. Backend resume focused on Go services."], ["frontend-resume", "Jordan Sample. Frontend resume focused on Vue."]]) {
    const dir = join(home, name);
    mkdirSync(dir);
    writeFileSync(join(dir, "resume.tex"), `\\documentclass{article}\n\\begin{document}\n${text}\n\\end{document}\n`);
    copyFileSync((await compileLatex(dir, "resume.tex", "pdflatex")).path, join(profileDir, `${name}.pdf`));
  }
  database = await import("../../db/index.ts");
  sources = await import("../../preparation/sources.ts");
  sources.saveSources({ projectDir: project, mainFile: "resume.tex", dataFile, engine: "pdflatex", profileDir });
  jobId = (database.db().query("INSERT INTO jobs (title, company_name, description, link) VALUES ('Engineer', 'Example', 'TypeScript role', 'https://example.com/apply') RETURNING id").get() as { id: number }).id;
  const { PreparationService } = await import("../../preparation/service.ts");
  service = new PreparationService({
    isRunning: false, cancel: vi.fn(), subscribe: () => () => {},
    run: async (_provider, _skill, params) => {
      const manifest = JSON.parse(readFileSync(params.manifestPath!, "utf8"));
      manifests.push({ ...manifest, profile: JSON.parse(readFileSync(manifest.profilePath, "utf8")) });
      writeFileSync(join(manifest.project, manifest.mainFile), "\\documentclass{article}\n\\begin{document}\nTailored resume.\n\\end{document}\n");
      writeFileSync(manifest.selectionPath, JSON.stringify({ language: "en" }));
      writeFileSync(manifest.reportPath, "# Changes");
      return { status: "done" };
    },
  }, vi.fn());
}, 60000);
afterAll(async () => { await service?.close(); database?.closeDb(); rmSync(home, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.WORK_TRACKER_HOME; else process.env.WORK_TRACKER_HOME = previousHome; });

test("generation imports the folder with Poppler and the agent's profile.json carries every source", async () => {
  expect(sources.snapshotSources().warnings).toContain("linkedin-export.pdf has not been imported yet.");
  const { handlePreparation } = await import("../../preparation/http.ts");
  const response = await handlePreparation("/api/application-preparation/generate", new Request("http://local", { method: "POST", body: JSON.stringify({ jobId, provider: "opencode" }) }), service);
  expect(response.status).toBe(202);
  expect((await complete(((await response.json()) as { id: string }).id)).status).toBe("completed");
  const profile = manifests[0]!.profile as { work: unknown[]; profileSources: import("../../profile/types.ts").ProfileSources };
  expect(profile.work).toHaveLength(2);
  const evidence = profile.profileSources;
  expect(evidence.linkedin!.experience.map(role => [role.company, role.title, role.start, role.end, role.location, role.bullets.length])).toEqual([
    ["Northwind Labs", "Senior Software Engineer", "2023-08", "Present", "Lisbon, Portugal", 2],
    ["Northwind Labs", "Software Engineer", "2022-12", "2023-07", "", 1],
    ["Contoso Analytics", "Backend Developer", "2019-06", "2022-11", "Porto, Portugal", 2],
    ["Fabrikam Studio", "Junior Developer", "2017-03", "2019-05", "", 1],
  ]);
  expect(evidence.linkedin!.summary).toBe("Software engineer building web platforms with TypeScript and React. Focused on reliable delivery and clear interfaces.");
  expect(evidence.linkedinOnly.map(role => role.company)).toEqual(["Contoso Analytics"]);
  expect(evidence.references.map(reference => [reference.file, reference.text])).toEqual([
    ["backend-resume.pdf", expect.stringContaining("Backend resume focused on Go services.")],
    ["frontend-resume.pdf", expect.stringContaining("Frontend resume focused on Vue.")],
  ]);
  // A month that differs is a conflict; the same year without a month is not.
  expect(evidence.conflicts.map(conflict => [conflict.field, conflict.values])).toEqual([["work.start", { data: "2022-11", linkedin: "2022-12" }]]);
  const { profileSourcesState } = await import("../../profile/state.ts");
  expect(profileSourcesState().assets.map(asset => [asset.file, asset.kind, asset.status])).toEqual([
    ["resume-data.json", "data", "imported"], ["backend-resume.pdf", "reference", "imported"], ["broken.pdf", "reference", "failed"],
    ["frontend-resume.pdf", "reference", "imported"], ["linkedin-export.pdf", "linkedin", "imported"],
  ]);
  expect(sources.snapshotSources().warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^broken\.pdf: The PDF could not be read/), "1 profile conflict needs a decision."]));
}, 90000);

test("a decision changes the source version and a frozen batch keeps the version it recorded", async () => {
  const before = sources.snapshotSources();
  const { freezeSources } = await import("../../preparation/batch-queue.ts");
  const frozen = freezeSources("profile-batch", before);
  const [conflict] = (await call("/api/profile-sources/choice", { key: (before.data!.profileSources as { conflicts: { key: string }[] }).conflicts[0]!.key, source: "linkedin" })).conflicts;
  expect(conflict!.chosen).toBe("linkedin");
  const after = sources.snapshotSources();
  expect(after.version).not.toBe(before.version);
  expect((after.data!.profileSources as { resolved: unknown[] }).resolved).toEqual([expect.objectContaining({ field: "work.start", source: "linkedin", value: "2022-12" })]);
  expect(after.warnings).not.toContain("1 profile conflict needs a decision.");
  const batch = sources.snapshotSources(frozen);
  expect(batch.version).toBe(before.version);
  expect(batch.data).toEqual(before.data);
  expect((await call("/api/profile-sources/choice", { key: conflict!.key, source: null })).conflicts[0]!.chosen).toBeNull();
  expect(sources.snapshotSources().version).toBe(before.version);
});

test("importing again reuses the cache unless forced, and the migration keeps the imports", async () => {
  const { importProfileAssets } = await import("../../profile/import.ts");
  expect(await importProfileAssets(profileDir)).toEqual({ imported: 0, cached: 4, failed: 0 });
  expect(await importProfileAssets(profileDir, { force: true })).toEqual({ imported: 3, cached: 0, failed: 1 });
  expect(database.db().query("SELECT kind, COUNT(*) AS n FROM profile_imports GROUP BY kind ORDER BY kind").all()).toEqual([{ kind: "linkedin", n: 1 }, { kind: "reference", n: 3 }]);
});
