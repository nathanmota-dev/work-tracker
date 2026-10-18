export type { PermissionRequest, PermissionSnapshot, ToolRule } from "../../../src/acp/permission-types"
import type { PermissionRequest } from "../../../src/acp/permission-types"
export function permissionDecision(request: PermissionRequest): string {
  const option = request.options.find(o => o.optionId === request.optionId)
  return `${request.title}: ${request.status === "cancelled" ? `Cancelled · ${request.reason}` : option?.kind.startsWith("allow_") ? "Allowed" : "Refused"}${option ? ` · ${option.name}` : ""}${request.remember && request.remember !== "once" ? ` · ${request.remember} rule` : ""}`
}
