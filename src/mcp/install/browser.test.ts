import * as fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { executableExists } from "../../cli/doctor.ts";
import { defaultChrome, ensureChromeBrowser, fallbackChrome, installedChrome, systemChrome } from "./browser.ts";

vi.mock("../../paths.ts", () => ({ paths: { tools: "/wt/tools" } }));
vi.mock("../../cli/doctor.ts", () => ({ executableExists: vi.fn() }));
vi.mock("../../cli/skills.ts", () => ({ agentEnvironment: () => ({ PATH: "/usr/bin" }) }));
const browsers = vi.hoisted(() => ({ detectBrowserPlatform: vi.fn(), resolveBuildId: vi.fn(), install: vi.fn() }));
vi.mock("@puppeteer/browsers", () => ({ Browser: { CHROME: "chrome" }, ...browsers }));

const files = new Map<string, string>();
const commands = new Set<string>();
beforeEach(() => {
  files.clear(); commands.clear();
  vi.mocked(executableExists).mockImplementation(command => commands.has(command));
  vi.mocked(fs.existsSync).mockImplementation(path => files.has(String(path)));
  vi.mocked(fs.readFileSync).mockImplementation(((path: string) => { const text = files.get(path); if (text === undefined) throw new Error("ENOENT"); return text; }) as unknown as typeof fs.readFileSync);
  vi.mocked(fs.writeFileSync).mockImplementation((path, data) => { files.set(String(path), String(data)); });
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
});

test("prefers the computer's Chrome or Chromium, then the downloaded build", () => {
  expect([systemChrome(), installedChrome(), defaultChrome(), fallbackChrome()]).toEqual([undefined, undefined, "google-chrome", undefined]);
  files.set("/wt/tools/chrome.json", JSON.stringify({ executablePath: "/wt/tools/chrome/chrome" }));
  expect(installedChrome()).toBeUndefined();
  files.set("/wt/tools/chrome/chrome", "");
  expect([defaultChrome(), fallbackChrome()]).toEqual(["/wt/tools/chrome/chrome", "/wt/tools/chrome/chrome"]);
  commands.add("chromium");
  expect([defaultChrome(), fallbackChrome()]).toEqual(["chromium", undefined]);
  files.set("/wt/tools/chrome.json", JSON.stringify({ executablePath: 7 }));
  expect(installedChrome()).toBeUndefined();
});

test("finds Chrome as a macOS application", () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  files.set("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "");
  expect(systemChrome()).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
});

test("downloads stable Chrome for Testing only when the computer has none", async () => {
  commands.add("google-chrome");
  expect(await ensureChromeBrowser()).toBe(false);
  commands.clear();
  browsers.detectBrowserPlatform.mockReturnValue("linux");
  browsers.resolveBuildId.mockResolvedValue("140.0.1");
  browsers.install.mockImplementation(async () => { files.set("/wt/tools/chrome/linux-140/chrome", ""); return { executablePath: "/wt/tools/chrome/linux-140/chrome" }; });
  expect(await ensureChromeBrowser()).toBe(true);
  expect(browsers.install).toHaveBeenCalledWith({ browser: "chrome", buildId: "140.0.1", platform: "linux", cacheDir: "/wt/tools/chrome" });
  expect(JSON.parse(files.get("/wt/tools/chrome.json")!)).toEqual({ buildId: "140.0.1", executablePath: "/wt/tools/chrome/linux-140/chrome" });
  expect(await ensureChromeBrowser()).toBe(false);
  files.clear();
  browsers.detectBrowserPlatform.mockReturnValue(undefined);
  await expect(ensureChromeBrowser()).rejects.toThrow("Install Google Chrome.");
});
