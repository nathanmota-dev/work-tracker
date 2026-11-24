import { beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import type { Database } from "../db/sqlite.ts";
import { memoryDatabase } from "../test/memory-db.ts";
import { inspectPdf } from "../preparation/latex.ts";
import { PreparationError } from "../preparation/sources.ts";
import { variantRecord } from "./store.ts";
import { importVariantPdf } from "./import.ts";

vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs")>()), statSync: vi.fn(), mkdirSync: vi.fn(), copyFileSync: vi.fn(), rmSync: vi.fn() }));
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "2026-11-24T12:00:00.000Z" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("../preparation/latex.ts", () => ({ inspectPdf: vi.fn() }));

let d: Database;
const input = { name: "My resume", role: "fullstack", stacks: ["React", ".NET"], path: "/home/user/resume.PDF" };
beforeEach(async () => {
  d = await memoryDatabase();
  vi.mocked(db).mockReturnValue(d);
  vi.mocked(fs.statSync).mockReturnValue({ size: 1000 } as fs.Stats);
  vi.mocked(inspectPdf).mockResolvedValue({ pages: 2, text: "Resume text", warnings: [] });
});

test("copies the PDF into the artifact folder and creates a ready imported variant", async () => {
  const id = await importVariantPdf(input);
  const target = `/artifacts/variants/${id}/imported/resume.pdf`;
  expect(fs.copyFileSync).toHaveBeenCalledWith(input.path, target);
  expect(inspectPdf).toHaveBeenCalledWith(target);
  expect(variantRecord(id)).toMatchObject({ name: "My resume", origin: "imported", status: "ready", sourceVersion: null, stacks: ["React", ".NET"], pdf: { kind: "variant", pages: 2 } });
  expect(d.query("SELECT text FROM pdf_artifacts").get()).toEqual({ text: "Resume text" });
  expect(d.query("SELECT summary FROM activity_log").get()).toEqual({ summary: "Imported saved resume My resume" });
});

test.each([
  [{ path: "resume.pdf" }, "Choose a PDF file."],
  [{ path: "/home/user/resume.docx" }, "Choose a PDF file."],
  [{ path: 3 }, "Choose a PDF file."],
  [{ stacks: [] }, "Add at least one stack."],
])("rejects %o before copying", async (change, message) => {
  await expect(importVariantPdf({ ...input, ...change })).rejects.toThrow(message);
  expect(fs.copyFileSync).not.toHaveBeenCalled();
});

test("rejects missing, large and unreadable PDFs and removes the copy", async () => {
  vi.mocked(fs.statSync).mockImplementationOnce(() => { throw new Error("ENOENT"); });
  await expect(importVariantPdf(input)).rejects.toThrow("not found");
  vi.mocked(fs.statSync).mockReturnValueOnce({ size: 11 * 1024 * 1024 } as fs.Stats);
  await expect(importVariantPdf(input)).rejects.toThrow("at most 10 MB");
  vi.mocked(inspectPdf).mockRejectedValueOnce(new Error("The PDF must contain at least one page with extractable text."));
  await expect(importVariantPdf(input)).rejects.toThrow("The PDF could not be read: The PDF must contain");
  vi.mocked(inspectPdf).mockRejectedValueOnce(new PreparationError("Known", 409));
  await expect(importVariantPdf(input)).rejects.toThrow(expect.objectContaining({ status: 409 }));
  expect(fs.rmSync).toHaveBeenCalledWith(expect.stringMatching(/^\/artifacts\/variants\/[0-9a-f-]{36}$/), { recursive: true, force: true });
  expect(d.query("SELECT COUNT(*) AS n FROM resume_variants").get()).toEqual({ n: 0 });
});
