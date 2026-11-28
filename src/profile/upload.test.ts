import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { profileAssets } from "./assets.ts";
import { profileEvidence } from "./evidence.ts";
import { readBbox } from "./linkedin/bbox.ts";
import { isLinkedInExport } from "./linkedin/detect.ts";
import type { StructuredSource } from "./types.ts";
import { safeName, uploadProfileFile } from "./upload.ts";

vi.mock("../paths.ts", () => ({ paths: { profile: "/profile" } }));
vi.mock("./assets.ts", () => ({ MAX_ASSETS: 2, MAX_ASSET_BYTES: 64, profileAssets: vi.fn() }));
vi.mock("./evidence.ts", () => ({ DATA_FILE: "resume-data.json", profileEvidence: vi.fn() }));
vi.mock("./linkedin/bbox.ts", () => ({ readBbox: vi.fn(async (path: string) => [{ path }]) }));
vi.mock("./linkedin/detect.ts", () => ({ isLinkedInExport: vi.fn() }));

const files = new Map<string, Buffer>();
const pdf = (text = "one") => Buffer.from(`%PDF-1.7 ${text}`);
const linkedin = (text = "export") => pdf(`linkedin ${text}`);
const body = (name: string, bytes: Buffer, replace?: boolean) => ({ name, base64: bytes.toString("base64"), ...(replace === undefined ? {} : { replace }) });
let source: StructuredSource | null;
beforeEach(() => {
  files.clear();
  source = null;
  vi.mocked(profileEvidence).mockImplementation(() => ({ data: null, raw: null, source, warnings: [], assets: [] }));
  vi.mocked(isLinkedInExport).mockImplementation(pages => files.get((pages[0] as unknown as { path: string }).path)!.includes("linkedin"));
  vi.mocked(profileAssets).mockImplementation(dir => ({ warnings: [], assets: [...files].filter(([path]) => path.startsWith(`${dir}/`) && path.endsWith(".pdf")).map(([path, bytes]) => ({ file: path.slice(dir.length + 1), path, sha256: createHash("sha256").update(bytes).digest("hex") })) }));
  vi.mocked(fs.existsSync).mockImplementation(path => files.has(String(path)));
  vi.mocked(fs.readFileSync).mockImplementation(((path: string) => files.get(String(path))!) as typeof fs.readFileSync);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.rmSync).mockImplementation(path => { files.delete(String(path)); });
  vi.mocked(fs.writeFileSync).mockImplementation((path, bytes) => { files.set(String(path), Buffer.from(bytes as Buffer)); });
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { files.set(String(to), files.get(String(from))!); files.delete(String(from)); });
});

test("keeps only a safe base name", () => {
  expect(safeName("../../etc/resume.pdf")).toBe("resume.pdf");
  expect(safeName("C:\\Users\\me\\cv.pdf")).toBe("cv.pdf");
  expect(safeName("..hidden\u0007.pdf")).toBe("hidden.pdf");
  for (const name of ["", "...", undefined, "a".repeat(201)]) expect(() => safeName(name)).toThrow("Choose a file with a valid name.");
});

test("creates the profile folder and copies a reference PDF into it atomically", async () => {
  expect(await uploadProfileFile(body("Resume.PDF", pdf()))).toEqual({ dir: "/profile", result: { file: "Resume.pdf", kind: "pdf", status: "added" } });
  expect(fs.mkdirSync).toHaveBeenCalledWith("/profile", { recursive: true, mode: 0o700 });
  expect([...files.keys()]).toEqual(["/profile/Resume.pdf"]);
  expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/^\/profile\/\.upload-.+\.tmp$/), pdf(), { mode: 0o600, flag: "wx" });
});

test("recognizes the same bytes, renames a different file with the same name and limits the count", async () => {
  await uploadProfileFile(body("resume.pdf", pdf()));
  expect((await uploadProfileFile(body("copy.pdf", pdf()))).result).toEqual({ file: "resume.pdf", kind: "pdf", status: "unchanged" });
  expect((await uploadProfileFile(body("resume.pdf", pdf("two")))).result.file).toBe("resume (2).pdf");
  await expect(uploadProfileFile(body("third.pdf", pdf("three")))).rejects.toThrow("The profile already has 2 PDFs.");
});

test("rejects other types, fake PDFs, empty and oversized files", async () => {
  await expect(uploadProfileFile(body("resume.docx", pdf()))).rejects.toThrow("Choose a PDF or a .json resume data file.");
  await expect(uploadProfileFile(body("resume.pdf", Buffer.from("hello")))).rejects.toThrow("resume.pdf is not a PDF.");
  await expect(uploadProfileFile({ name: "resume.pdf", base64: "" })).rejects.toThrow("The file is empty.");
  await expect(uploadProfileFile({ name: "resume.pdf", base64: "====" })).rejects.toThrow("The file is empty.");
  await expect(uploadProfileFile({ name: "resume.pdf", base64: 3 })).rejects.toThrow("The file is empty.");
  await expect(uploadProfileFile(body("resume.pdf", Buffer.alloc(65, 1)))).rejects.toThrow("Files must be 20 MB or smaller.");
  await expect(uploadProfileFile({ name: "resume.pdf", base64: "A".repeat(200) })).rejects.toThrow("Files must be 20 MB or smaller.");
  expect(files.size).toBe(0);
});

test("validates resume data and saves it as the profile's data file", async () => {
  await expect(uploadProfileFile(body("data.json", Buffer.from("{")))).rejects.toThrow("Invalid resume data");
  await expect(uploadProfileFile(body("data.json", Buffer.from('{"work":{}}')))).rejects.toThrow("work must be an array.");
  const data = Buffer.from('{"skills":["React"]}');
  expect((await uploadProfileFile(body("mine.json", data))).result).toEqual({ file: "resume-data.json", kind: "data", status: "added" });
  expect(files.get("/profile/resume-data.json")).toEqual(data);
  expect((await uploadProfileFile(body("mine.json", data))).result.status).toBe("unchanged");
});

test("a data file replaces the LinkedIn export, or other data, only when confirmed", async () => {
  files.set("/profile/export.pdf", linkedin());
  source = { kind: "linkedin", file: "export.pdf" };
  const data = Buffer.from('{"skills":["Rust"]}');
  expect((await uploadProfileFile(body("data.json", data))).result).toEqual({ file: "resume-data.json", kind: "data", status: "replace_required", replaces: "export.pdf" });
  expect([...files.keys()]).toEqual(["/profile/export.pdf"]);
  expect((await uploadProfileFile(body("data.json", data, true))).result.status).toBe("added");
  expect([...files.keys()]).toEqual(["/profile/resume-data.json"]);
  source = { kind: "data", file: "resume-data.json" };
  const next = Buffer.from('{"skills":["Go"]}');
  expect((await uploadProfileFile(body("data.json", next))).result.status).toBe("replace_required");
  expect((await uploadProfileFile(body("data.json", next, true))).result.status).toBe("added");
  expect(files.get("/profile/resume-data.json")).toEqual(next);
});

test("a LinkedIn export replaces the current source only when confirmed; a reference PDF never asks", async () => {
  files.set("/profile/resume-data.json", Buffer.from("{}"));
  source = { kind: "data", file: "resume-data.json" };
  expect((await uploadProfileFile(body("cv.pdf", pdf()))).result.status).toBe("added");
  expect((await uploadProfileFile(body("Profile.pdf", linkedin()))).result).toEqual({ file: "Profile.pdf", kind: "pdf", status: "replace_required", replaces: "resume-data.json" });
  expect([...files.keys()].sort()).toEqual(["/profile/cv.pdf", "/profile/resume-data.json"]);
  expect((await uploadProfileFile(body("Profile.pdf", linkedin(), true))).result.status).toBe("added");
  expect([...files.keys()].sort()).toEqual(["/profile/Profile.pdf", "/profile/cv.pdf"]);
});

test("an unreadable PDF is a reference resume, and the temporary file goes when the rename fails", async () => {
  vi.mocked(readBbox).mockRejectedValueOnce(new Error("pdftotext missing"));
  source = { kind: "data", file: "resume-data.json" };
  expect((await uploadProfileFile(body("cv.pdf", pdf()))).result.status).toBe("added");
  vi.mocked(fs.renameSync).mockImplementation(() => { throw new Error("EXDEV"); });
  await expect(uploadProfileFile(body("other.pdf", pdf("other")))).rejects.toThrow("EXDEV");
  expect([...files.keys()]).toEqual(["/profile/cv.pdf"]);
});
