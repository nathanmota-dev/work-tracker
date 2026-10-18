import { db } from "../db/index.ts";
import type { PermissionRequest, ToolRule } from "./permission-types.ts";
import { sameRule } from "./permission-policy.ts";

const key = "agent_tool_allowlist";
export const permissionStore = {
  rules(): ToolRule[] {
    const row = db().query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : [];
  },
  setRule(rule: ToolRule, enabled: boolean): void {
    const rules = this.rules().filter(item => !sameRule(item, rule));
    if (enabled) rules.push(rule);
    db().query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(rules));
  },
  save(request: PermissionRequest, rule?: ToolRule): void {
    const d = db();
    d.transaction(() => {
      const summary = `${request.title}: ${request.status}${request.optionId ? ` (${request.optionId})` : ""}${request.reason ? ` · ${request.reason}` : ""}`;
      const row = d.query("SELECT id FROM activity_log WHERE kind = 'agent_permission' AND json_extract(payload_json, '$.id') = ?").get(request.id) as { id: number } | undefined;
      if (row) d.query("UPDATE activity_log SET summary = ?, payload_json = ? WHERE id = ?").run(summary, JSON.stringify(request), row.id);
      else d.query("INSERT INTO activity_log (kind, summary, payload_json) VALUES ('agent_permission', ?, ?)").run(summary, JSON.stringify(request));
      if (rule) this.setRule(rule, true);
    })();
  },
  history(): PermissionRequest[] {
    const rows = db().query("SELECT payload_json FROM activity_log WHERE kind = 'agent_permission' ORDER BY id DESC LIMIT 100").all() as { payload_json: string }[];
    return rows.map(row => JSON.parse(row.payload_json));
  },
  recover(): void {
    const rows = db().query("SELECT payload_json FROM activity_log WHERE kind = 'agent_permission' AND json_extract(payload_json, '$.status') = 'pending'").all() as { payload_json: string }[];
    for (const row of rows) this.save({ ...JSON.parse(row.payload_json), status: "cancelled", reason: "App restarted", decidedAt: new Date().toISOString() });
  },
};
