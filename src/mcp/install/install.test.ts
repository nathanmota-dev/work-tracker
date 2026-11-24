import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { executableExists } from "../../cli/doctor.ts";
import { loadConfig } from "../../paths.ts";
import { runCommand } from "../../preparation/command.ts";
import { installChrome } from "./chrome.ts";
import { ensureChromeBrowser } from "./browser.ts";
import { customCommand, ensureMcpServers, installFailure, installRunning, installStates, onInstallChange } from "./index.ts";
import { installLinkedIn, LINKEDIN_MCP_VERSION } from "./linkedin.ts";
import { installState, setInstall } from "./state.ts";
import { ensureUv, uvTarget, UV_SHA256, UV_VERSION } from "./uv.ts";

vi.mock("../../paths.ts", () => ({ loadConfig: vi.fn(), paths: { bin: "/wt/bin", tools: "/wt/tools", home: "/wt" } }));
vi.mock("../../cli/doctor.ts", () => ({ executableExists: vi.fn() }));
vi.mock("../../cli/skills.ts", () => ({ agentEnvironment: () => ({ PATH: "/wt/bin:/usr/bin" }) }));
vi.mock("../../preparation/command.ts", () => ({ runCommand: vi.fn() }));
vi.mock("./browser.ts", () => ({ ensureChromeBrowser: vi.fn() }));

const files = new Map<string, string>();
const onPath = new Set<string>();
beforeEach(() => {
  files.clear(); onPath.clear();
  vi.mocked(loadConfig).mockReturnValue({});
  vi.mocked(executableExists).mockImplementation(command => onPath.has(command) || files.has(`/wt/bin/${command}`));
  vi.mocked(fs.existsSync).mockImplementation(path => [...files.keys()].some(file => file === String(path) || file.startsWith(`${String(path)}/`)));
  vi.mocked(fs.readFileSync).mockImplementation(((path: string) => { const text = files.get(String(path)); if (text === undefined) throw new Error("ENOENT"); return text; }) as unknown as typeof fs.readFileSync);
  vi.mocked(fs.writeFileSync).mockImplementation((path, data) => { files.set(String(path), String(data)); });
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.rmSync).mockImplementation(path => { for (const file of [...files.keys()]) if (file === String(path) || file.startsWith(`${String(path)}/`)) files.delete(file); });
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { for (const [file, text] of [...files]) if (file === String(from) || file.startsWith(`${String(from)}/`)) { files.delete(file); files.set(String(to) + file.slice(String(from).length), text); } });
  vi.spyOn(fs, "chmodSync").mockReturnValue(undefined);
  vi.spyOn(fs, "cpSync").mockImplementation((from, to) => { for (const [file, text] of [...files]) if (file.startsWith(`${String(from)}/`)) files.set(String(to) + file.slice(String(from).length), text); });
  vi.mocked(ensureChromeBrowser).mockResolvedValue(false);
});

test("maps this computer to a uv release and refuses unsupported systems", () => {
  expect(uvTarget("linux", "x64")).toBe("x86_64-unknown-linux-gnu");
  expect(uvTarget("darwin", "arm64")).toBe("aarch64-apple-darwin");
  expect(uvTarget("win32", "x64")).toBeNull();
  expect(uvTarget("linux", "ia32")).toBeNull();
});

test("uses an existing uv before downloading one", async () => {
  files.set("/wt/bin/uv", "");
  expect(await ensureUv()).toBe("/wt/bin/uv");
  files.clear(); onPath.add("uv");
  expect(await ensureUv()).toBe("uv");
  expect(fetch).not.toHaveBeenCalled();
});

test("downloads the pinned uv, verifies it and extracts only the executable", async () => {
  const archive = Buffer.from("archive");
  const target = uvTarget()!;
  vi.mocked(fetch).mockResolvedValueOnce(new Response(archive));
  await expect(ensureUv()).rejects.toThrow("integrity check");
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.tar.gz`);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(ensureUv()).rejects.toThrow("Download failed (404).");
  const published = UV_SHA256[target]!;
  UV_SHA256[target] = createHash("sha256").update(archive).digest("hex");
  try {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(archive));
    vi.mocked(runCommand).mockImplementationOnce(async (_tar, args) => { files.set(`${args.at(-1)}/uv-${target}/uv`, "binary"); files.set(`${args.at(-1)}/uv-${target}/uvx`, "binary"); return ""; });
    expect(await ensureUv()).toBe("/wt/bin/uv");
    expect(files.get("/wt/bin/uv")).toBe("binary");
    expect(fs.chmodSync).toHaveBeenCalledWith(expect.stringMatching(/\/uv$/), 0o755);
    expect([...files.keys()].filter(file => file.includes(".uv-"))).toEqual([]);
  } finally { UV_SHA256[target] = published; }
});

test("installs the pinned LinkedIn MCP as an isolated tool, and only once", async () => {
  onPath.add("uv");
  vi.mocked(runCommand).mockImplementation(async () => { files.set("/wt/bin/mcp-server-linkedin", ""); return ""; });
  expect(await installLinkedIn()).toBe(true);
  expect(runCommand).toHaveBeenCalledWith("uv", ["tool", "install", "--force", `mcp-server-linkedin==${LINKEDIN_MCP_VERSION}`], undefined, undefined, 900000, {
    UV_TOOL_DIR: "/wt/tools/uv-tools", UV_TOOL_BIN_DIR: "/wt/bin", UV_PYTHON_INSTALL_DIR: "/wt/tools/python", UV_CACHE_DIR: "/wt/tools/uv-cache",
  });
  expect(files.get("/wt/tools/mcp-server-linkedin.version")).toBe(`${LINKEDIN_MCP_VERSION}\n`);
  expect(await installLinkedIn()).toBe(false);
  // An older copy of the app's own server is updated.
  files.set("/wt/tools/mcp-server-linkedin.version", "1.0.0\n");
  expect(await installLinkedIn()).toBe(true);
  expect(runCommand).toHaveBeenCalledTimes(2);
});

test("keeps a LinkedIn MCP the user installed and reports a broken installation", async () => {
  onPath.add("mcp-server-linkedin");
  expect(await installLinkedIn()).toBe(false);
  onPath.clear(); onPath.add("uv");
  vi.mocked(runCommand).mockResolvedValue("");
  await expect(installLinkedIn()).rejects.toThrow("its executable was not found");
});

test("copies the bundled Chrome MCP out of the app and starts it with Node", async () => {
  vi.stubEnv("WORK_TRACKER_RESOURCES", "/app/resources");
  files.set("/app/resources/mcp/chrome-devtools-mcp/package.json", JSON.stringify({ version: "1.12.0" }));
  files.set("/app/resources/mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js", "// server");
  vi.mocked(ensureChromeBrowser).mockResolvedValueOnce(true);
  expect(await installChrome()).toBe(true);
  expect(files.get("/wt/tools/chrome-devtools-mcp/1.12.0/build/src/bin/chrome-devtools-mcp.js")).toBe("// server");
  expect(files.get("/wt/bin/chrome-devtools-mcp")).toBe("#!/bin/sh\nexec node '/wt/tools/chrome-devtools-mcp/1.12.0/build/src/bin/chrome-devtools-mcp.js' \"$@\"\n");
  expect(await installChrome()).toBe(false);
  expect(fs.cpSync).toHaveBeenCalledOnce();
});

test("keeps a Chrome MCP the user installed and needs the bundled one otherwise", async () => {
  vi.stubEnv("WORK_TRACKER_RESOURCES", "/missing");
  vi.stubEnv("WORK_TRACKER_REPO_ROOT", "/missing");
  vi.spyOn(process, "cwd").mockReturnValue("/missing");
  onPath.add("chrome-devtools-mcp");
  expect(await installChrome()).toBe(false);
  expect(ensureChromeBrowser).toHaveBeenCalled();
  onPath.clear();
  await expect(installChrome()).rejects.toThrow("The Chrome MCP shipped with Work Tracker is missing.");
});

test("installs each default server, reports states and skips configured commands", async () => {
  const changed = vi.fn();
  onInstallChange(changed);
  onPath.add("mcp-server-linkedin").add("chrome-devtools-mcp");
  const done = ensureMcpServers();
  expect(installRunning()).toBe(true);
  expect(ensureMcpServers()).toBe(done);
  expect((await done).map(item => [item.name, item.state, item.message])).toEqual([["linkedin", "ready", "LinkedIn MCP is installed."], ["chrome", "ready", "Chrome MCP is installed."]]);
  expect(installRunning()).toBe(false);
  expect(changed).toHaveBeenCalled();
  vi.mocked(loadConfig).mockReturnValue({ mcp: { chrome: { command: "/opt/chrome-mcp" } }, linkedinMcpCommand: ["/opt/linkedin"] });
  expect((await ensureMcpServers()).map(item => item.state)).toEqual(["custom", "custom"]);
  vi.mocked(loadConfig).mockReturnValue({});
  vi.stubEnv("WORK_TRACKER_SKIP_MCP_INSTALL", "1");
  expect((await ensureMcpServers()).map(item => item.state)).toEqual(["disabled", "disabled"]);
});

test("a failure becomes a readable state without process output", async () => {
  onPath.add("uv");
  vi.mocked(runCommand).mockRejectedValue(new Error("uv failed (2):\n/home/me/secret path"));
  vi.mocked(ensureChromeBrowser).mockRejectedValue(new TypeError("fetch failed"));
  vi.stubEnv("WORK_TRACKER_RESOURCES", "/app/resources");
  files.set("/app/resources/mcp/chrome-devtools-mcp/package.json", JSON.stringify({ version: "1.12.0" }));
  files.set("/app/resources/mcp/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js", "");
  const states = await ensureMcpServers();
  expect(states.find(item => item.name === "linkedin")).toEqual({ name: "linkedin", state: "failed", message: "LinkedIn MCP could not be installed. Try again, or configure its command in Settings → Integrations." });
  expect(installState("chrome").message).toBe("Chrome MCP could not be downloaded. Check your internet connection, then try again.");
});

test("classifies failures and recognizes configured commands", () => {
  expect(installFailure("linkedin", new Error("The downloaded uv archive failed its integrity check."))).toBe("LinkedIn MCP download was corrupted. Try again.");
  expect(installFailure("chrome", new Error("Automatic installation is not available on Windows. Install chrome-devtools-mcp, then test the integration."))).toContain("not available on Windows");
  expect(installFailure("chrome", "ETIMEDOUT")).toContain("could not be downloaded");
  expect(customCommand("linkedin", { linkedinMcpCommand: [] })).toBe(false);
  expect(customCommand("chrome", { mcp: { chrome: { command: "", args: ["--headless"] } } })).toBe(false);
});

test("announces only real state changes", () => {
  const changed = vi.fn();
  onInstallChange(changed);
  setInstall("chrome", "installing", "Installing Chrome MCP…");
  setInstall("chrome", "installing", "Installing Chrome MCP…");
  expect(changed).toHaveBeenCalledOnce();
  expect(installStates().map(item => item.name)).toEqual(["linkedin", "chrome"]);
});
