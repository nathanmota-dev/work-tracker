import { beforeEach, afterEach, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import { db } from "../db/index.ts";
import { databaseDouble, deferred } from "../test/doubles.ts";
import { jobDetails } from "../mcp/search.ts";
import { openChromePortal } from "../mcp/chrome.ts";
import { compileLatex, dependencyStatus, inspectPdf } from "./latex.ts";
import {
  PreparationError,
  snapshotSources,
  sourcesConfig,
  writeSnapshot,
} from "./sources.ts";
import {
  addArtifact,
  artifactFile,
  cachedPreview,
  runManifest,
  runRecord,
  updateRun,
} from "./store.ts";
import { PreparationService, readableJobDetails } from "./service.ts";
import type { PreparationRun, PdfArtifact } from "./types.ts";
type ApiEvent = Record<string, unknown>;
vi.mock("../db/index.ts", () => ({ db: vi.fn(), now: () => "now" }));
vi.mock("../paths.ts", () => ({ paths: { artifacts: "/artifacts" } }));
vi.mock("../mcp/search.ts", () => ({ jobDetails: vi.fn() }));
vi.mock("../mcp/chrome.ts", () => ({ openChromePortal: vi.fn() }));
vi.mock("./latex.ts", () => ({
  compileLatex: vi.fn(),
  dependencyStatus: vi.fn(),
  inspectPdf: vi.fn(),
}));
vi.mock("./sources.ts", async (original) => ({
  ...(await original<typeof import("./sources.ts")>()),
  snapshotSources: vi.fn(),
  sourcesConfig: vi.fn(),
  writeSnapshot: vi.fn(),
}));
vi.mock("./store.ts", () => ({
  addArtifact: vi.fn(),
  artifactFile: vi.fn(),
  cachedPreview: vi.fn(),
  runManifest: vi.fn(),
  runRecord: vi.fn(),
  updateRun: vi.fn(),
}));
let d: ReturnType<typeof databaseDouble>;
let service: PreparationService;
let job: {
  id: number;
  title: string;
  company_name: string;
  description: string | null;
  link: string;
  archived_at: string | null;
  linkedin_job_id?: string;
};
let application:
  | {
      id: number;
      status: string;
      external_url: string;
      preparation_run_id: string | null;
    }
  | undefined;
let run: PreparationRun;
let listener: (event: ApiEvent) => void;
const acp = {
  run: vi.fn(),
  cancel: vi.fn(),
  isRunning: false,
  subscribe: vi.fn(),
};
const broadcast = vi.fn();
const unsubscribe = vi.fn();
const pdf: PdfArtifact = { id: "base", kind: "base", pages: 1, warnings: [] };
const source = "% keep\n\\documentclass{article}\n\\begin{document}\nResume";
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(service.isBusy).toBe(false);
};
beforeEach(() => {
  d = databaseDouble();
  vi.mocked(db).mockReturnValue(d.asDatabase);
  job = {
    id: 1,
    title: "Engineer",
    company_name: "Acme",
    description: "React developer",
    link: "https://portal.invalid",
    archived_at: null,
  };
  application = {
    id: 2,
    status: "draft",
    external_url: "https://portal.invalid",
    preparation_run_id: null,
  };
  run = {
    id: "r",
    job_id: 1,
    application_id: 2,
    status: "completed",
    phase: "review",
    provider: "agent",
    model: "model",
    error: null,
    report: null,
    events: [],
    artifacts: [{ ...pdf, id: "tailored", kind: "tailored" }],
    created_at: "now",
    updated_at: "now",
  };
  d.query.mockImplementation((sql) => ({
    ...d.statement,
    get: vi.fn((...args: unknown[]) => {
      d.statement.get(...args);
      return sql.includes("FROM jobs")
        ? job
        : sql.includes("INSERT INTO applications")
          ? { id: 2 }
          : application;
    }),
  }));
  acp.run.mockReset().mockResolvedValue({ status: "completed" });
  acp.cancel.mockReset();
  acp.isRunning = false;
  acp.subscribe.mockImplementation((callback) => {
    listener = callback;
    return unsubscribe;
  });
  broadcast.mockClear();
  unsubscribe.mockClear();
  vi.mocked(sourcesConfig).mockReturnValue({
    projectDir: "/project",
    mainFile: "resume.tex",
    dataFile: "",
    engine: "pdflatex",
  });
  vi.mocked(snapshotSources)
    .mockReset()
    .mockReturnValue({
      config: sourcesConfig(),
      files: [{ name: "resume.tex", bytes: Buffer.from(source) }],
      version: "v1",
      data: null,
      warnings: [],
    });
  vi.mocked(writeSnapshot).mockClear();
  vi.mocked(cachedPreview).mockReset().mockReturnValue(pdf);
  vi.mocked(compileLatex)
    .mockReset()
    .mockResolvedValue({
      path: "/compiled.pdf",
      log: "ok",
      check: { pages: 2, text: "resume", warnings: [] },
    });
  vi.mocked(dependencyStatus).mockResolvedValue([
    { command: "latexmk", available: true },
  ]);
  vi.mocked(inspectPdf)
    .mockReset()
    .mockResolvedValue({ pages: 1, text: "resume", warnings: [] });
  vi.mocked(openChromePortal).mockReset().mockResolvedValue();
  vi.mocked(addArtifact).mockReset().mockReturnValue(pdf);
  vi.mocked(artifactFile)
    .mockReset()
    .mockReturnValue({
      path: "/artifacts/validated.pdf",
      text: "resume",
      artifact: pdf,
    });
  vi.mocked(runRecord)
    .mockReset()
    .mockImplementation(() => run);
  vi.mocked(runManifest).mockReturnValue({
    manifestPath: "/artifacts/r/manifest.json",
    reportPath: "/artifacts/r/report.md",
    coverPath: "/artifacts/r/cover.md",
  });
  vi.mocked(updateRun)
    .mockReset()
    .mockImplementation((_id, fields) => {
      Object.assign(run, fields);
    });
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.rmSync).mockReturnValue(undefined);
  vi.spyOn(fs, "copyFileSync").mockReturnValue(undefined);
  vi.mocked(fs.readFileSync).mockImplementation((path) =>
    String(path).endsWith(".tex")
      ? source
      : String(path).endsWith("selection.json")
        ? "{}"
        : String(path).endsWith("fill-result.json")
          ? '{"fields":{"name":"Ana"},"unfilled":[]}'
          : "report",
  );
  service = new PreparationService(acp, broadcast);
});
afterEach(async () => {
  await service.close();
});
test.each([
  [null, ""],
  ["plain text", "plain text"],
  ['{"description":"role"}', "role"],
  [{ structuredContent: { job_description: "role" } }, "role"],
  [{ jobDescription: "role" }, "role"],
  [{ details: "role" }, "role"],
  [{ content: [{ text: "one" }, { text: "two" }] }, "one\n\ntwo"],
  [{ company: "Acme" }, '{\n  "company": "Acme"\n}'],
])("normalizes job details %j", (input, expected) => {
  expect(readableJobDetails(input)).toBe(expected);
});
test("marks running records interrupted on startup and removes event subscription on close", async () => {
  expect(d.query.mock.calls[0]![0]).toContain("status = 'interrupted'");
  await service.close();
  expect(unsubscribe).toHaveBeenCalled();
});
test("reports source dependencies, cache and warnings without generating output", async () => {
  expect(await service.sourcesState()).toEqual(
    expect.objectContaining({
      preview: pdf,
      busy: false,
      dependencies: [{ command: "latexmk", available: true }],
    }),
  );
  vi.mocked(snapshotSources).mockImplementation(() => {
    throw new PreparationError("missing sources");
  });
  expect((await service.sourcesState()).warnings).toEqual(["missing sources"]);
});
test("preview uses cache or builds a private snapshot and always releases busy state", async () => {
  expect(await service.preview()).toEqual(pdf);
  expect(compileLatex).not.toHaveBeenCalled();
  vi.mocked(cachedPreview).mockReturnValue(null);
  await service.preview();
  expect(writeSnapshot).toHaveBeenCalled();
  expect(addArtifact).toHaveBeenCalledWith(
    null,
    "base",
    "/compiled.pdf",
    expect.anything(),
    "v1",
  );
  vi.mocked(compileLatex).mockRejectedValue(new Error("compile failed"));
  await expect(service.preview()).rejects.toThrow("compile failed");
  expect(service.isBusy).toBe(false);
});
test("blocks concurrent execution and cancels a pending preview", async () => {
  const pending = deferred<Awaited<ReturnType<typeof compileLatex>>>();
  vi.mocked(cachedPreview).mockReturnValue(null);
  vi.mocked(compileLatex).mockImplementation(
    (_project, _main, _engine, signal) => {
      signal!.addEventListener("abort", () =>
        pending.reject(new Error("Cancelled")),
      );
      return pending.promise;
    },
  );
  const preview = expect(service.preview()).rejects.toThrow("Cancelled");
  expect(() => service.generate({ jobId: 1 })).toThrow("active execution");
  await expect(service.cancel("other")).rejects.toThrow("not active");
  await service.cancel("preview");
  await preview;
  expect(acp.cancel).toHaveBeenCalled();
  expect(service.isBusy).toBe(false);
});
test("details enforces job/application identity and exposes history/status", () => {
  d.statement.all.mockReturnValue([{ id: "r" }]);
  expect(service.details({ jobId: 1, applicationId: 2 })).toEqual(
    expect.objectContaining({ runs: [run], applicationStatus: "draft" }),
  );
  application = undefined;
  expect(() => service.details({ jobId: 1, applicationId: 2 })).toThrow(
    "not found for this job",
  );
  expect(() => service.details({ jobId: "1" })).toThrow("saved job");
});
test("description trims, validates, persists and notifies", () => {
  expect(() => service.description({ jobId: 1, description: " " })).toThrow(
    "description",
  );
  service.description({ jobId: 1, description: " Updated " });
  expect(d.statement.run).toHaveBeenCalledWith("Updated", 1);
  expect(broadcast).toHaveBeenCalledWith({ type: "changed", table: "jobs" });
});
test("rejects invalid generation targets/providers and submitted applications", () => {
  expect(() => service.generate({ jobId: 0 })).toThrow("saved job");
  expect(() => service.generate({ jobId: 1 })).toThrow("agent");
  job.archived_at = "now";
  expect(() => service.generate({ jobId: 1, provider: "agent" })).toThrow(
    "Restore",
  );
  job.archived_at = null;
  application!.status = "submitted";
  expect(() =>
    service.generate({ jobId: 1, provider: "agent", applicationId: 2 }),
  ).toThrow("already submitted");
  application = undefined;
  expect(() =>
    service.generate({ jobId: 1, provider: "agent", applicationId: 2 }),
  ).toThrow("another job");
});
test("generates a validated PDF, snapshots inputs and only then updates the application", async () => {
  service.generate({
    jobId: 1,
    provider: "agent",
    applicationId: 2,
    extra: "context",
  });
  await settle();
  expect(acp.run).toHaveBeenCalledWith(
    "agent",
    "resume-tailor",
    expect.objectContaining({ extra: "context" }),
    "model",
  );
  expect(fs.copyFileSync).toHaveBeenCalledWith(
    "/compiled.pdf",
    expect.stringContaining("resume.pdf"),
  );
  expect(addArtifact).toHaveBeenCalledWith(
    expect.any(String),
    "tailored",
    expect.any(String),
    expect.objectContaining({ warnings: [expect.stringContaining("2 pages")] }),
  );
  expect(run.status).toBe("completed");
  expect(broadcast).toHaveBeenCalledWith({
    type: "changed",
    table: "applications",
  });
});
test("creates an application only when generation has no existing application", async () => {
  application = undefined;
  run.application_id = null;
  d.query.mockImplementation((sql) => ({
    ...d.statement,
    get: vi.fn(() =>
      sql.includes("FROM jobs")
        ? job
        : sql.includes("SELECT id FROM applications WHERE job_id")
          ? undefined
          : sql.includes("INSERT INTO applications")
            ? { id: 2 }
            : { status: "draft" },
    ),
  }));
  service.generate({ jobId: 1, provider: "agent" });
  await settle();
  expect(run.application_id).toBe(2);
  expect(d.query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO applications"),
  );
});
test.each([
  "comments",
  "preamble",
  "compile",
  "selection",
  "report",
  "missing-report",
])(
  "bounds correction attempts for invalid %s and preserves previous PDF",
  async (kind) => {
    const originalRead = vi.mocked(fs.readFileSync).getMockImplementation()!;
    if (kind === "compile")
      vi.mocked(compileLatex).mockRejectedValue(new Error("bad compile"));
    else
      vi.mocked(fs.readFileSync).mockImplementation((...args) => {
        const path = String(args[0]);
        if (path.endsWith(".tex") && kind === "comments")
          return source.replace("% keep\n", "");
        if (path.endsWith(".tex") && kind === "preamble")
          return source.replace("article", "book");
        if (path.endsWith("selection.json") && kind === "selection")
          return "[]";
        if (path.endsWith("report.md") && kind === "report") return " ";
        return originalRead(...args);
      });
    if (kind === "missing-report")
      vi.mocked(fs.existsSync).mockReturnValue(false);
    service.generate({ jobId: 1, provider: "agent", applicationId: 2 });
    await settle();
    expect(acp.run).toHaveBeenCalledTimes(2);
    expect(run.status).toBe("failed");
    expect(
      vi.mocked(addArtifact).mock.calls.some(([, kind]) => kind === "tailored"),
    ).toBe(false);
    expect(
      d.query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE applications SET status = 'draft'"),
      ),
    ).toBe(false);
  },
);
test.each(["", "LinkedIn sign-in pending"])(
  "does not treat unavailable descriptions as content",
  async (description) => {
    job.description = null;
    job.linkedin_job_id = "123";
    vi.mocked(jobDetails).mockResolvedValue({ description });
    service.generate({ jobId: 1, provider: "agent" });
    await settle();
    expect(run.status).toBe("failed");
    expect(acp.run).not.toHaveBeenCalled();
  },
);
test("fetches missing descriptions and blocks generation when the application was submitted meanwhile", async () => {
  job.description = null;
  job.linkedin_job_id = "123";
  vi.mocked(jobDetails).mockResolvedValue({ description: "Fetched role" });
  acp.run.mockImplementation(async () => {
    application!.status = "submitted";
    return { status: "completed" };
  });
  service.generate({ jobId: 1, provider: "agent" });
  await settle();
  expect(job.description).toBe("Fetched role");
  expect(run.status).toBe("failed");
  expect(run.error).toContain("submitted during generation");
});
test("retains sign-in state, allows cancel after the task and retries with the same run", async () => {
  acp.run.mockResolvedValue({ status: "waiting_for_sign_in" });
  service.fill({ runId: "r" });
  await settle();
  expect(run.status).toBe("waiting_for_sign_in");
  await service.cancel("r");
  expect(run.status).toBe("cancelled");
  acp.run.mockResolvedValue({ status: "completed" });
  service.fill({ runId: "r" });
  await settle();
  expect(run.status).toBe("completed");
  expect(openChromePortal).toHaveBeenCalledWith("https://portal.invalid/");
});
test("fill uses the selected artifact and validated result without marking submitted", async () => {
  service.fill({ runId: "r", extra: "fill context" });
  await settle();
  expect(inspectPdf).toHaveBeenCalledWith(
    "/artifacts/validated.pdf",
    expect.any(AbortSignal),
  );
  expect(acp.run).toHaveBeenCalledWith(
    "agent",
    "portal-filler",
    expect.objectContaining({ runId: "r", extra: "fill context" }),
    "model",
  );
  expect(d.query).toHaveBeenCalledWith(
    expect.stringContaining("status = 'filled'"),
  );
  expect(
    d.query.mock.calls.some(([sql]) => sql.includes("status = 'submitted'")),
  ).toBe(false);
});
test.each([
  '{"fields":[],"unfilled":[]}',
  '{"fields":{},"unfilled":null}',
  '{"fields":{},"unfilled":[],"externalUrl":"javascript:bad"}',
  "{",
])("rejects invalid fill result %s", async (result) => {
  vi.mocked(fs.readFileSync).mockReturnValue(result);
  service.fill({ runId: "r" });
  await settle();
  expect(run.status).toBe("failed");
  expect(
    d.query.mock.calls.some(([sql]) => sql.includes("status = 'filled'")),
  ).toBe(false);
});
test("rejects archived/unvalidated/submitted fill targets and unsafe portal URLs", () => {
  job.archived_at = "now";
  expect(() => service.fill({ runId: "r" })).toThrow("Restore");
  job.archived_at = null;
  run.artifacts = [];
  expect(() => service.fill({ runId: "r" })).toThrow("validated PDF");
  run.artifacts = [{ ...pdf, kind: "tailored" }];
  application!.status = "submitted";
  expect(() => service.fill({ runId: "r" })).toThrow("already submitted");
  application!.status = "draft";
  application!.external_url = "file:///secret";
  expect(() => service.fill({ runId: "r" })).toThrow("HTTP or HTTPS");
});
test("cancel aborts a pending agent and filters/bounds events for the active execution", async () => {
  const pending = deferred<{ status: string }>();
  acp.run.mockReturnValue(pending.promise);
  service.fill({ runId: "r" });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  vi.mocked(updateRun).mockClear();
  listener({ type: "acp-log", runId: "other", line: "ignore" });
  expect(updateRun).not.toHaveBeenCalled();
  run.events = Array.from({ length: 500 }, () => ({ type: "old" }));
  listener({ type: "acp-log", runId: "r", line: "new" });
  const fields = vi.mocked(updateRun).mock.calls.at(-1)![1];
  expect(JSON.parse(fields.events_json!).length).toBe(500);
  acp.cancel.mockImplementation(() => pending.resolve({ status: "cancelled" }));
  await service.cancel("r");
  expect(run.status).toBe("cancelled");
  expect(service.isBusy).toBe(false);
});
test("submission requires the currently filled execution and is always explicit", () => {
  service.submitted({ runId: "r" });
  expect(d.statement.run).toHaveBeenLastCalledWith("now", 2, "r");
  expect(broadcast).toHaveBeenCalledWith({
    type: "changed",
    table: "applications",
  });
  d.statement.run.mockReturnValue({ changes: 0, lastInsertRowid: 0 });
  expect(() => service.submitted({ runId: "r" })).toThrow("Fill and submit");
});

test("fails a generation with no description or LinkedIn reference before starting the agent", async () => {
  job.description = null;
  service.generate({ jobId: 1, provider: "agent" });
  await settle();
  expect(run.status).toBe("failed");
  expect(run.error).toContain("Add the job description");
  expect(acp.run).not.toHaveBeenCalled();
});
test("records agent execution failures and releases the execution lock", async () => {
  acp.run.mockResolvedValue({ status: "error", message: "Agent unavailable" });
  service.fill({ runId: "r" });
  await settle();
  expect(run.status).toBe("failed");
  expect(run.error).toBe("Agent unavailable");
  expect(broadcast).not.toHaveBeenCalledWith({
    type: "changed",
    table: "applications",
  });
});
test("closing during execution aborts work and unsubscribes", async () => {
  const pending = deferred<{ status: string }>();
  const started = deferred<void>();
  acp.run.mockImplementation(() => {
    started.resolve();
    return pending.promise;
  });
  acp.cancel.mockImplementation(() => pending.resolve({ status: "cancelled" }));
  service.fill({ runId: "r" });
  await started.promise;
  await service.close();
  expect(run.status).toBe("cancelled");
  expect(service.isBusy).toBe(false);
  expect(unsubscribe).toHaveBeenCalled();
});
