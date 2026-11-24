import { beforeEach, expect, test, vi } from "vitest";
import { runCommand } from "../preparation/command.ts";
import { ENGLISH_EXPORT, bboxXhtml } from "../test/linkedin-fixtures.ts";
import { profileAssets } from "./assets.ts";
import { syncProfileAnswers } from "./autofill.ts";
import { ensureProfileImported, importProfileAssets } from "./import.ts";
import { cachedImports, saveImport } from "./store.ts";

vi.mock("../preparation/command.ts", () => ({ runCommand: vi.fn() }));
vi.mock("./assets.ts", () => ({ profileAssets: vi.fn() }));
vi.mock("./store.ts", () => ({ cachedImports: vi.fn(), saveImport: vi.fn() }));
vi.mock("./autofill.ts", () => ({ syncProfileAnswers: vi.fn() }));

const asset = (file: string) => ({ file, path: `/profile/${file}`, sha256: `hash-${file}` });
const outputs: Record<string, string | Error> = {};
beforeEach(() => {
  vi.mocked(profileAssets).mockReturnValue({ assets: ["export.pdf", "other.pdf", "scan.pdf", "broken.pdf"].map(asset), warnings: [] });
  vi.mocked(cachedImports).mockReturnValue(new Map());
  Object.assign(outputs, { "export.pdf": bboxXhtml(ENGLISH_EXPORT), "other.pdf": bboxXhtml([["Jordan Sample", "Experience"]], () => ""), "scan.pdf": "<page></page>", "broken.pdf": new Error("pdftotext failed (1):\nSyntax Error") });
  vi.mocked(runCommand).mockImplementation(async (_command, args) => {
    const output = outputs[args.at(-2)!.replace("/profile/", "")]!;
    if (output instanceof Error) throw output;
    return args.includes("-layout") ? (args.at(-2)!.includes("other") ? "Jordan   Sample\n\nResume" : " ") : output;
  });
});
const saved = () => vi.mocked(saveImport).mock.calls.map(([value]) => value);

test("extracts the LinkedIn export, keeps other PDFs as reference text and records failures as warnings", async () => {
  expect(await importProfileAssets("/profile")).toEqual({ imported: 2, cached: 0, failed: 2 });
  expect(profileAssets).toHaveBeenCalledWith("/profile");
  const [linkedin, reference, scan, broken] = saved();
  expect(linkedin).toMatchObject({ hash: "hash-export.pdf", kind: "linkedin", file: "export.pdf", warnings: [] });
  expect(linkedin!.profile!.experience).toHaveLength(4);
  expect(linkedin!.text).toContain("Alex Example");
  expect(reference).toEqual({ hash: "hash-other.pdf", kind: "reference", file: "other.pdf", profile: null, text: "Jordan Sample Resume", warnings: [] });
  expect(scan).toMatchObject({ kind: "reference", text: "", warnings: ["The PDF has no extractable text. Scanned PDFs are not supported."] });
  expect(broken).toMatchObject({ kind: "reference", text: "", warnings: ["The PDF could not be read: pdftotext failed (1):"] });
});

test("skips PDFs with a valid import unless forced", async () => {
  vi.mocked(cachedImports).mockReturnValue(new Map([["hash-export.pdf", {} as never], ["hash-other.pdf", {} as never]]));
  expect(await importProfileAssets("/profile")).toEqual({ imported: 0, cached: 2, failed: 2 });
  expect(cachedImports).toHaveBeenCalledWith(["hash-export.pdf", "hash-other.pdf", "hash-scan.pdf", "hash-broken.pdf"]);
  vi.mocked(saveImport).mockClear();
  expect(await importProfileAssets("/profile", { force: true })).toEqual({ imported: 2, cached: 0, failed: 2 });
  expect(saved()).toHaveLength(4);
});

test("a cancelled import stops instead of recording a failure, and the next import still runs", async () => {
  const controller = new AbortController();
  vi.mocked(runCommand).mockImplementationOnce(async () => { controller.abort(); throw new Error("Cancelled"); });
  await expect(importProfileAssets("/profile", { signal: controller.signal })).rejects.toThrow();
  expect(saveImport).not.toHaveBeenCalled();
  expect((await importProfileAssets("/profile")).imported).toBe(2);
});

test("generation imports what is missing and is never blocked by the import", async () => {
  await ensureProfileImported("");
  await ensureProfileImported(undefined);
  expect(profileAssets).not.toHaveBeenCalled();
  vi.mocked(profileAssets).mockImplementationOnce(() => { throw new Error("EACCES"); });
  await expect(ensureProfileImported("/profile")).resolves.toBeUndefined();
  await ensureProfileImported("/profile");
  expect(saved()).toHaveLength(4);
  // Every call fills empty answers, with or without a profile folder.
  expect(syncProfileAnswers).toHaveBeenCalledTimes(4);
});
