import { paths } from "../paths.ts";
import { executableExists } from "../cli/doctor.ts";
import { agentEnvironment } from "../cli/skills.ts";
import { dependencyStatus } from "../preparation/latex.ts";
import { sourcesConfig } from "../preparation/sources.ts";
import { closeMcp } from "../mcp/linkedin.ts";
import { recordVerification } from "../onboarding/store.ts";
import { commandFingerprint, configSnapshot, configuredCommand, integrationSettings, IntegrationError, saveIntegration, targetId, targets } from "./config.ts";
import { probeIntegration, type Diagnostic } from "./probe.ts";

const results = new Map<string, Diagnostic>();
let testing = false;
export function integrationTesting() { return testing; }
export function resetDiagnostics() { results.clear(); }
export function executable(target: typeof targets[number]) {
  const command = configuredCommand(target);
  return executableExists(command.command, { ...agentEnvironment(), ...command.env }, paths.workspace);
}
export async function integrationStatus() {
  const { revision } = configSnapshot();
  return { backend: true, entries: targets.map(target => ({ target, executable: executable(target), diagnostic: results.get(`${revision}/${target}`) })), dependencies: await dependencyStatus(sourcesConfig().engine) };
}
export async function handleIntegrations(path: string, req: Request, busy: boolean | (() => boolean), broadcast: (event: unknown) => void): Promise<Response> {
  try {
    if (req.method === "GET" && path === "/api/integrations") return Response.json(integrationSettings());
    if (req.method === "GET" && path === "/api/integrations/status") return Response.json(await integrationStatus());
    if (req.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const raw: unknown = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
    if ((typeof busy === "function" ? busy() : busy) || testing) throw new IntegrationError("Finish or cancel the active execution or diagnostic first.", 409);
    testing = true;
    try {
      if (path === "/api/integrations") {
        const settings = saveIntegration(body);
        await closeMcp();
        resetDiagnostics();
        broadcast({ type: "changed", table: "integrations" });
        return Response.json(settings);
      }
      if (path !== "/api/integrations/test") return Response.json({ error: "Not found." }, { status: 404 });
      const target = targetId(body?.target);
      const model = body?.model ?? "";
      if (typeof model !== "string" || model.length > 256 || [...model].some(character => character.charCodeAt(0) < 32)) throw new IntegrationError("Choose a valid model identifier.");
      const { revision, config } = configSnapshot();
      const checks = executable(target) ? await probeIntegration(target, model) : [{ stage: "executable", state: "missing_executable" as const, message: "The executable was not found. Install it or correct its command and PATH, then test again." }];
      const diagnostic: Diagnostic = { target, model, checkedAt: new Date().toISOString(), checks };
      results.set(`${revision}/${target}`, diagnostic);
      recordVerification(target, commandFingerprint(target, config), checks.every(check => check.state === "ready" || check.state === "unverified"));
      broadcast({ type: "changed", table: "integrations" });
      return Response.json(diagnostic);
    } finally { testing = false; }
  } catch (error) {
    return Response.json({ error: error instanceof IntegrationError ? error.message : "Integration settings could not be read or saved. Your previous configuration is preserved." }, { status: error instanceof IntegrationError ? error.status : 500 });
  }
}
