import { afterAll, beforeAll, expect, test } from "vitest";
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProfileSourcesState, UploadResult } from "../../profile/types.ts";

// A user without a repository checkout or any configured source: everything happens in the UI.
const home = mkdtempSync(join(tmpdir(), "work tracker upload "));
const previous = { home: process.env.WORK_TRACKER_HOME, root: process.env.WORK_TRACKER_REPO_ROOT };
process.env.WORK_TRACKER_HOME = home;
process.env.WORK_TRACKER_REPO_ROOT = join(home, "no-repository");
const exportPdf = resolve("src/test/fixtures/profile/linkedin-export.pdf");
const profileDir = join(home, "profile");
let database: typeof import("../../db/index.ts");
let watch: typeof import("../../profile/watch.ts");
const events: unknown[] = [];

async function request(path: string, body?: unknown) {
  const { handleProfileSources } = await import("../../profile/http.ts");
  const req = new Request("http://local", body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
  const response = await handleProfileSources(path, req, event => events.push(event));
  return { status: response.status, body: await response.json() as ProfileSourcesState & { upload: UploadResult; error?: string } };
}
const upload = (name: string, bytes: Buffer, replace?: boolean) => request("/api/profile-sources/upload", { name, base64: bytes.toString("base64"), ...(replace && { replace }) });
const files = (state: ProfileSourcesState) => state.assets.map(asset => [asset.file, asset.kind, asset.status]);

beforeAll(async () => {
  database = await import("../../db/index.ts");
  watch = await import("../../profile/watch.ts");
});
afterAll(() => {
  watch?.stopProfileWatch();
  database?.closeDb();
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of [["WORK_TRACKER_HOME", previous.home], ["WORK_TRACKER_REPO_ROOT", previous.root]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("an upload creates the profile, imports the LinkedIn export and survives a restart of the config", async () => {
  const { status, body } = await upload("My LinkedIn.pdf", readFileSync(exportPdf));
  expect([status, body.upload]).toEqual([200, { file: "My LinkedIn.pdf", kind: "pdf", status: "added" }]);
  expect(body.profileDir).toBe(profileDir);
  expect(files(body)).toEqual([["My LinkedIn.pdf", "linkedin", "imported"]]);
  expect(body.linkedin?.experiences).toBe(4);
  expect(readdirSync(profileDir)).toEqual(["My LinkedIn.pdf"]);
  expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).resumeSources.profileDir).toBe(profileDir);
  expect(events).toEqual([{ type: "changed", table: "profile_imports" }, { type: "changed", table: "resume_sources" }]);
  // Uploading the same export again changes nothing.
  expect((await upload("copy.pdf", readFileSync(exportPdf))).body.upload.status).toBe("unchanged");
});

test("resume data is validated, becomes the data file and is replaced only when confirmed", async () => {
  const invalid = await upload("data.json", Buffer.from('{"work":{}}'));
  expect([invalid.status, invalid.body.error]).toEqual([400, "work must be an array."]);
  const first = Buffer.from(JSON.stringify({ work: [{ company: "Northwind Labs", start: "2022-11", end: "Present" }] }));
  expect((await upload("cv-data.json", first)).body.upload.status).toBe("added");
  const dataFile = join(profileDir, "resume-data.json");
  const { sourcesConfig } = await import("../../preparation/sources.ts");
  expect(sourcesConfig()).toMatchObject({ projectDir: "", dataFile, profileDir });
  const second = Buffer.from(JSON.stringify({ skills: ["Go"] }));
  expect((await upload("other.json", second)).body.upload.status).toBe("replace_required");
  expect(readFileSync(dataFile)).toEqual(first);
  const replaced = await upload("other.json", second, true);
  expect(replaced.body.upload.status).toBe("added");
  expect(readFileSync(dataFile)).toEqual(second);
  expect(files(replaced.body)[0]).toEqual(["resume-data.json", "data", "imported"]);
});

test("a PDF placed in the folder by hand is imported without any request", async () => {
  watch.startProfileWatch(() => events.push("imported"));
  const { cachedImports } = await import("../../profile/store.ts");
  const { profileAssets } = await import("../../profile/assets.ts");
  const placed = join(profileDir, "placed-by-hand.pdf");
  // A different file: the export with trailing bytes, which PDF readers ignore.
  copyFileSync(exportPdf, placed);
  appendFileSync(placed, "\n%placed\n");
  const hash = profileAssets(profileDir).assets.find(asset => asset.file === "placed-by-hand.pdf")!.sha256;
  await expect.poll(() => cachedImports([hash]).size, { timeout: 15000, interval: 200 }).toBe(1);
  expect(events).toContain("imported");
  const state = (await request("/api/profile-sources")).body;
  expect(state.importing).toBe(false);
  expect(files(state)).toContainEqual(["placed-by-hand.pdf", "linkedin", "imported"]);
}, 30000);
