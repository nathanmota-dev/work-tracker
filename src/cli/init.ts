import { db, now } from "../db/index.ts";
import { ensureHome, paths, loadConfig, saveConfig } from "../paths.ts";

/** work-tracker init — scaffold ~/.work-tracker/, create db, seed config */
export function initCmd(): void {
  ensureHome();
  db(); // triggers schema creation
  const cfg = loadConfig();
  if (!cfg.provider) {
    cfg.provider = "opencode";
    saveConfig(cfg);
  }
  console.log(`Work Tracker initialized at ${paths.home}`);
  console.log(`  db:     ${paths.db}`);
  console.log(`  config: ${paths.config}`);
  console.log(`Run \`work-tracker dashboard\` to open the hub.`);
}
