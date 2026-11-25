import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnOwned, stopOwned } from "../acp/process.ts";
import { loadConfig } from "../paths.ts";
import { processDouble } from "../test/doubles.ts";
vi.mock("../acp/process.ts", () => ({
  spawnOwned: vi.fn(),
  stopOwned: vi.fn(),
}));
vi.mock("../paths.ts", () => ({
  loadConfig: vi.fn(),
  paths: { chromeProfile: "/private/chrome/profile" },
}));
vi.mock("./install/browser.ts", () => ({ defaultChrome: () => "google-chrome" }));
let p: ReturnType<typeof processDouble>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  p = processDouble();
  vi.mocked(loadConfig).mockReturnValue({});
  vi.mocked(spawnOwned).mockReset().mockReturnValue(p.asChild);
  vi.mocked(stopOwned).mockReset();
  vi.mocked(mkdirSync).mockReturnValue(undefined);
  vi.mocked(rmSync).mockReturnValue(undefined);
  vi.mocked(readFileSync).mockReturnValue("4321\n/devtools/browser/fixture\n");
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      webSocketDebuggerUrl: "ws://127.0.0.1:4321/devtools/browser/fixture",
    }),
  );
});
test("opens regular Chrome once, verifies its port, reuses it and forgets closed browsers", async () => {
  const { openChromeLogin, chromeBrowserUrl } = await import("./chrome.ts");
  await Promise.all([openChromeLogin(), openChromeLogin()]);
  expect(spawnOwned).toHaveBeenCalledOnce();
  expect(spawnOwned).toHaveBeenCalledWith(
    "google-chrome",
    expect.arrayContaining([
      "--user-data-dir=/private/chrome/profile",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "https://www.linkedin.com/login",
    ]),
    expect.objectContaining({ graceMs: 3000 }),
  );
  expect(rmSync).toHaveBeenCalledWith(
    "/private/chrome/profile/DevToolsActivePort",
    { force: true },
  );
  expect(chromeBrowserUrl()).toBe("http://127.0.0.1:4321");
  await openChromeLogin();
  expect(spawnOwned).toHaveBeenCalledOnce();
  p.child.emit("close", 0);
  expect(chromeBrowserUrl()).toBeUndefined();
  expect(stopOwned).toHaveBeenCalledWith(p.asChild);
});
test("keeps the configured executable, Chrome arguments, proxy and environment", async () => {
  vi.mocked(loadConfig).mockReturnValue({
    mcp: {
      chrome: {
        command: "mcp",
        args: [
          "--executablePath",
          "/custom/chrome",
          "--chrome-arg=--ozone-platform=x11",
          "--proxyServer=http://proxy.invalid",
        ],
        env: { DISPLAY: ":1" },
      },
    },
  });
  const { openChromeLogin } = await import("./chrome.ts");
  await openChromeLogin();
  expect(spawnOwned).toHaveBeenCalledWith(
    "/custom/chrome",
    expect.arrayContaining([
      "--ozone-platform=x11",
      "--proxy-server=http://proxy.invalid",
    ]),
    { env: expect.objectContaining({ DISPLAY: ":1" }), graceMs: 3000 },
  );
});
test("does not replace external connections or accept profile overrides", async () => {
  const { openChromeLogin } = await import("./chrome.ts");
  vi.mocked(loadConfig).mockReturnValue({
    mcp: {
      chrome: { command: "mcp", args: ["--browser-url=http://127.0.0.1:9222"] },
    },
  });
  await expect(openChromeLogin()).rejects.toThrow(
    "external browser connection",
  );
  vi.mocked(loadConfig).mockReturnValue({
    mcp: {
      chrome: { command: "mcp", args: ["--chromeArg=--user-data-dir=/shared"] },
    },
  });
  await expect(openChromeLogin()).rejects.toThrow("owns the Chrome profile");
  expect(spawnOwned).not.toHaveBeenCalled();
});
test("startup errors clean up the owned process and allow retry", async () => {
  vi.mocked(readFileSync).mockImplementation(() => {
    throw new Error("not ready");
  });
  const { openChromeLogin, chromeBrowserUrl } = await import("./chrome.ts");
  const opening = openChromeLogin();
  const failure = expect(opening).rejects.toThrow("ENOENT");
  p.child.emit("error", new Error("ENOENT"));
  await vi.advanceTimersByTimeAsync(100);
  await failure;
  expect(stopOwned).toHaveBeenCalledWith(p.asChild);
  expect(chromeBrowserUrl()).toBeUndefined();
  vi.mocked(readFileSync).mockReturnValue("4321\n/devtools/browser/fixture\n");
  await openChromeLogin();
  expect(chromeBrowserUrl()).toBe("http://127.0.0.1:4321");
});
test("rejects stale or malformed debugging endpoints and stops the browser on timeout", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      webSocketDebuggerUrl: "ws://127.0.0.1:4321/devtools/browser/unrelated",
    }),
  );
  const { openChromeLogin, chromeBrowserUrl } = await import("./chrome.ts");
  const failure = expect(openChromeLogin()).rejects.toThrow("did not start");
  await vi.advanceTimersByTimeAsync(10000);
  await failure;
  expect(chromeBrowserUrl()).toBeUndefined();
  expect(stopOwned).toHaveBeenCalledWith(p.asChild);
});

test.each([
  "--browser-url=x",
  "--browserUrl",
  "--ws-endpoint=x",
  "--wsEndpoint",
  "-u",
  "-w",
  "--autoConnect",
  "--auto-connect=true",
])("recognizes external connection option %s", async (arg) => {
  const { hasChromeConnection } = await import("./chrome.ts");
  expect(hasChromeConnection([arg])).toBe(true);
  expect(hasChromeConnection(["--autoConnect", "false"])).toBe(false);
  expect(hasChromeConnection(["--autoConnect=false"])).toBe(false);
});
test("opens a portal URL, reuses its browser and respects external connections", async () => {
  const { openChromePortal } = await import("./chrome.ts");
  vi.mocked(loadConfig).mockReturnValue({
    mcp: { chrome: { command: "mcp", args: ["--autoConnect"] } },
  });
  await openChromePortal("https://portal.invalid");
  expect(spawnOwned).not.toHaveBeenCalled();
  vi.mocked(loadConfig).mockReturnValue({});
  await openChromePortal("https://portal.invalid");
  expect(spawnOwned).toHaveBeenCalledWith(
    "google-chrome",
    expect.arrayContaining(["https://portal.invalid"]),
    expect.anything(),
  );
  await openChromePortal("https://other.invalid");
  expect(spawnOwned).toHaveBeenCalledOnce();
});
test("portal waits for a pending login launch without starting another browser", async () => {
  const { openChromePortal, openChromeLogin, chromeLoginOpening } =
    await import("./chrome.ts");
  const login = openChromeLogin();
  expect(chromeLoginOpening()).toBe(true);
  await Promise.all([login, openChromePortal("https://portal.invalid")]);
  expect(spawnOwned).toHaveBeenCalledOnce();
  expect(chromeLoginOpening()).toBe(false);
});
test("supports channel/argument variants and rejects missing executables", async () => {
  const { openChromePortal } = await import("./chrome.ts");
  vi.mocked(loadConfig).mockReturnValue({
    mcp: { chrome: { command: "mcp", args: ["--executablePath", "--bad"] } },
  });
  await expect(openChromePortal("https://portal.invalid")).rejects.toThrow(
    "path is missing",
  );
  vi.mocked(loadConfig).mockReturnValue({
    mcp: {
      chrome: {
        command: "mcp",
        args: ["--channel=beta", "--chrome-arg", "--disable-gpu"],
      },
    },
  });
  await openChromePortal("https://portal.invalid");
  expect(spawnOwned).toHaveBeenCalledWith(
    "google-chrome-beta",
    expect.arrayContaining(["--disable-gpu"]),
    expect.anything(),
  );
});
