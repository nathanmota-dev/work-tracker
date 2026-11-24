import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig, saveConfig } from "../paths.ts";
import { sourcesConfig } from "../preparation/sources.ts";
import { profileAssets } from "./assets.ts";
import { isFolder } from "./evidence.ts";
import { safeName, uploadProfileFile } from "./upload.ts";

vi.mock("../paths.ts", () => ({ loadConfig: vi.fn(), saveConfig: vi.fn(), paths: { profile: "/home/.work-tracker/profile" } }));
vi.mock("../preparation/sources.ts", async (original) => ({ ...(await original<typeof import("../preparation/sources.ts")>()), sourcesConfig: vi.fn() }));
vi.mock("./assets.ts", () => ({ MAX_ASSETS: 2, MAX_ASSET_BYTES: 64, profileAssets: vi.fn() }));
vi.mock("./evidence.ts", () => ({ isFolder: vi.fn() }));

const files = new Map<string, Buffer>();
const config = { projectDir: "/latex", mainFile: "resume.tex", dataFile: "", engine: "pdflatex" as const, profileDir: "/profile" };
const pdf = (text = "one") => Buffer.from(`%PDF-1.7 ${text}`);
const body = (name: string, bytes: Buffer, replace?: boolean) => ({ name, base64: bytes.toString("base64"), ...(replace === undefined ? {} : { replace }) });
beforeEach(() => {
  files.clear();
  vi.mocked(sourcesConfig).mockReturnValue({ ...config });
  vi.mocked(loadConfig).mockReturnValue({ username: "kept" });
  vi.mocked(isFolder).mockReturnValue(true);
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

test("copies a PDF into the profile folder atomically, without temporary files left", () => {
  expect(uploadProfileFile(body("Resume.PDF", pdf()))).toEqual({ dir: "/profile", result: { file: "Resume.pdf", kind: "pdf", status: "added" } });
  expect([...files.keys()]).toEqual(["/profile/Resume.pdf"]);
  expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringMatching(/^\/profile\/\.upload-.+\.tmp$/), pdf(), { mode: 0o600, flag: "wx" });
  expect(saveConfig).not.toHaveBeenCalled();
});

test("recognizes the same bytes, renames a different file with the same name and limits the count", () => {
  uploadProfileFile(body("resume.pdf", pdf()));
  expect(uploadProfileFile(body("copy.pdf", pdf())).result).toEqual({ file: "resume.pdf", kind: "pdf", status: "unchanged" });
  expect(uploadProfileFile(body("resume.pdf", pdf("two"))).result.file).toBe("resume (2).pdf");
  expect(() => uploadProfileFile(body("third.pdf", pdf("three")))).toThrow("The profile already has 2 PDFs.");
});

test("rejects other types, fake PDFs, empty and oversized files", () => {
  expect(() => uploadProfileFile(body("resume.docx", pdf()))).toThrow("Choose a PDF or a .json resume data file.");
  expect(() => uploadProfileFile(body("resume.pdf", Buffer.from("hello")))).toThrow("resume.pdf is not a PDF.");
  expect(() => uploadProfileFile({ name: "resume.pdf", base64: "" })).toThrow("The file is empty.");
  expect(() => uploadProfileFile({ name: "resume.pdf", base64: "====" })).toThrow("The file is empty.");
  expect(() => uploadProfileFile({ name: "resume.pdf", base64: 3 })).toThrow("The file is empty.");
  expect(() => uploadProfileFile(body("resume.pdf", Buffer.alloc(65, 1)))).toThrow("Files must be 20 MB or smaller.");
  expect(() => uploadProfileFile({ name: "resume.pdf", base64: "A".repeat(200) })).toThrow("Files must be 20 MB or smaller.");
  expect(files.size).toBe(0);
});

test("creates the app's profile folder for a user without one and remembers it", () => {
  vi.mocked(sourcesConfig).mockReturnValue({ ...config, profileDir: "" });
  expect(uploadProfileFile(body("cv.pdf", pdf())).dir).toBe("/home/.work-tracker/profile");
  expect(fs.mkdirSync).toHaveBeenCalledWith("/home/.work-tracker/profile", { recursive: true, mode: 0o700 });
  expect(saveConfig).toHaveBeenCalledWith({ username: "kept", resumeSources: { ...config, profileDir: "/home/.work-tracker/profile" } });
});

test("never writes into a configured folder that no longer exists", () => {
  vi.mocked(isFolder).mockReturnValue(false);
  expect(() => uploadProfileFile(body("cv.pdf", pdf()))).toThrow("The profile folder no longer exists.");
});

test("validates resume data and makes it the data file in use", () => {
  expect(() => uploadProfileFile(body("data.json", Buffer.from("{")))).toThrow("Invalid resume data");
  expect(() => uploadProfileFile(body("data.json", Buffer.from('{"work":{}}')))).toThrow("work must be an array.");
  const data = Buffer.from('{"skills":["React"]}');
  expect(uploadProfileFile(body("mine.json", data)).result).toEqual({ file: "resume-data.json", kind: "data", status: "added" });
  expect(files.get("/profile/resume-data.json")).toEqual(data);
  expect(saveConfig).toHaveBeenCalledWith({ username: "kept", resumeSources: { ...config, dataFile: "/profile/resume-data.json" } });
});

test("replaces different resume data only when confirmed, and knows identical data", () => {
  const current = Buffer.from('{"skills":["Go"]}');
  files.set("/elsewhere/data.json", current);
  vi.mocked(sourcesConfig).mockReturnValue({ ...config, dataFile: "/elsewhere/data.json" });
  // The same data as the file in use is copied into the folder without a question.
  expect(uploadProfileFile(body("data.json", current)).result.status).toBe("added");
  vi.mocked(sourcesConfig).mockReturnValue({ ...config, dataFile: "/profile/resume-data.json" });
  expect(uploadProfileFile(body("data.json", current)).result.status).toBe("unchanged");
  const next = Buffer.from('{"skills":["Rust"]}');
  expect(uploadProfileFile(body("data.json", next)).result.status).toBe("replace_required");
  expect(files.get("/profile/resume-data.json")).toEqual(current);
  expect(uploadProfileFile(body("data.json", next, true)).result.status).toBe("added");
  expect(files.get("/profile/resume-data.json")).toEqual(next);
});

test("removes the temporary file when the rename fails", () => {
  vi.mocked(fs.renameSync).mockImplementation(() => { throw new Error("EXDEV"); });
  expect(() => uploadProfileFile(body("cv.pdf", pdf()))).toThrow("EXDEV");
  expect(files.size).toBe(0);
});
