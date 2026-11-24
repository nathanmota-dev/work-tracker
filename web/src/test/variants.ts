import { desktopDouble } from "./doubles"
import type { ResumeVariant } from "@/lib/variants"

/** A saved resume as the backend lists it; override any field. */
export function variant(fields: Partial<ResumeVariant> = {}): ResumeVariant {
  return {
    id: "v1", name: "Back-End · C#, .NET", role: "backend", stacks: ["C#", ".NET"], focus: null, language: "auto", origin: "generated", status: "ready",
    phase: "complete", provider: "opencode", model: null, error: null, report: "Report", sourceVersion: "s1", events: [], pdf: { id: "pdf-v1", kind: "variant", pages: 1, warnings: [] },
    archivedAt: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", stale: false, ...fields,
  }
}

/** A connected desktop bridge whose requests answer from `routes`; unknown paths return `{ ok: true }`. */
export function desktopWith(routes: Record<string, unknown>) {
  const desktop = desktopDouble()
  desktop.connectionStatus.mockResolvedValue(true)
  desktop.request.mockImplementation(async (path: string, body?: unknown) => {
    const route = routes[path]
    return typeof route === "function" ? route(body) : route ?? { ok: true }
  })
  window.desktop = desktop
  return desktop
}
