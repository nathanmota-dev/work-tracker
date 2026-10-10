import { beforeEach, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { exportCmd } from "./export.ts";
import { cliSpies } from "../test/doubles.ts";
let output: ReturnType<typeof cliSpies>;
beforeEach(() => {
  output = cliSpies();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(mkdirSync).mockReturnValue(undefined);
});
test("export creates output directory and invokes Typst with literal paths and timeout", async () => {
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<
    typeof spawnSync
  >);
  await exportCmd({
    typ: "/input path/resume.typ",
    out: "/output path/resume.pdf",
  });
  expect(mkdirSync).toHaveBeenCalledWith("/output path", { recursive: true });
  expect(spawnSync).toHaveBeenCalledWith(
    "typst",
    ["compile", "/input path/resume.typ", "/output path/resume.pdf"],
    { encoding: "utf8", timeout: 60000 },
  );
  expect(output.log).toHaveBeenCalledWith("exported /output path/resume.pdf");
});
test("missing fields/input never start a process and compiler failures report stderr or spawn error", async () => {
  await expect(exportCmd({})).rejects.toThrow("exit:1");
  vi.mocked(existsSync).mockReturnValue(false);
  await expect(
    exportCmd({ typ: "missing.typ", out: "out.pdf" }),
  ).rejects.toThrow("exit:1");
  expect(spawnSync).not.toHaveBeenCalled();
  vi.mocked(existsSync).mockReturnValue(true);
  for (const result of [
    { status: 1, stderr: "bad document" },
    { status: null, error: new Error("ENOENT") },
  ]) {
    vi.mocked(spawnSync).mockReturnValue(
      result as ReturnType<typeof spawnSync>,
    );
    await expect(
      exportCmd({ typ: "resume.typ", out: "out.pdf" }),
    ).rejects.toThrow("exit:1");
    expect(output.error).toHaveBeenLastCalledWith(
      `error: typst compile failed:\n${"error" in result ? "ENOENT" : "bad document"}`,
    );
  }
});
