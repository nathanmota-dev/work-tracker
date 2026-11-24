import { expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { MAX_ASSET_BYTES, profileAssets } from "./assets.ts";

type Item = { name: string; link?: boolean; folder?: boolean; size?: number; mtime?: number };
function folder(items: Item[]) {
  vi.mocked(fs.readdirSync).mockReturnValue(items.map(item => ({ name: item.name, isSymbolicLink: () => !!item.link, isFile: () => !item.link && !item.folder })) as never);
  vi.spyOn(fs, "statSync").mockImplementation(path => { const item = items.find(entry => `/profile/${entry.name}` === String(path))!; return { size: item.size ?? 10, mtimeMs: item.mtime ?? 1 } as fs.Stats; });
  vi.mocked(fs.readFileSync).mockImplementation(path => Buffer.from(String(path)));
}

test("lists top-level PDFs by name with their hash, skipping links, folders, other files and large PDFs", () => {
  folder([{ name: "z.PDF" }, { name: "notes.txt" }, { name: "linked.pdf", link: true }, { name: "nested.pdf", folder: true }, { name: "huge.pdf", size: MAX_ASSET_BYTES + 1 }, { name: "a.pdf" }]);
  const { assets, warnings } = profileAssets("/profile");
  expect(assets.map(asset => [asset.file, asset.path, asset.sha256.length])).toEqual([["a.pdf", "/profile/a.pdf", 64], ["z.PDF", "/profile/z.PDF", 64]]);
  expect(warnings).toEqual(["huge.pdf exceeds 20 MB and was skipped.", "linked.pdf is a link and was skipped. Copy the PDF into the profile folder."]);
  expect(fs.readdirSync).toHaveBeenCalledWith("/profile", { withFileTypes: true });
});

test("uses at most 10 PDFs and hashes an unchanged file only once", () => {
  folder(Array.from({ length: 12 }, (_, i) => ({ name: `resume-${String(i).padStart(2, "0")}.pdf`, mtime: 5 })));
  const first = profileAssets("/profile");
  expect(first.assets).toHaveLength(10);
  expect(first.warnings).toEqual(["Only the first 10 PDFs of the profile folder are used."]);
  vi.mocked(fs.readFileSync).mockClear();
  expect(profileAssets("/profile").assets).toEqual(first.assets);
  expect(fs.readFileSync).not.toHaveBeenCalled();
  folder([{ name: "resume-00.pdf", mtime: 6 }]);
  profileAssets("/profile");
  expect(fs.readFileSync).toHaveBeenCalledOnce();
});
