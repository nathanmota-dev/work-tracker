export type PermissionOption = { optionId: string; name: string; kind: string };
export type ToolRule = { provider: string; tool: string };
export type PermissionRequest = {
  id: string;
  runId: string;
  sessionId: string;
  provider: string;
  tool: string;
  title: string;
  context: string;
  options: PermissionOption[];
  rememberable: boolean;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "selected" | "cancelled";
  optionId?: string;
  reason?: string;
  remember?: "once" | "session" | "persistent";
  decidedAt?: string;
};
export type PermissionAnswer = {
  id: string;
  runId: string;
  sessionId: string;
  optionId?: string;
  remember?: "once" | "session" | "persistent";
};
export type PermissionSnapshot = {
  execution?: { runId: string; sessionId?: string; status: "starting" | "running" | "waiting_for_permission" | "done" | "cancelled" | "error" | "waiting_for_sign_in" };
  pending: PermissionRequest[];
  history: PermissionRequest[];
  rules: ToolRule[];
  sessionRules: (ToolRule & { sessionId: string })[];
};
