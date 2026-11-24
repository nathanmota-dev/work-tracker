export type McpName = "linkedin" | "chrome";
/**
 * `custom`: config.json configures its own command, which is never installed.
 * `ready` includes a server the user installed on PATH themselves.
 */
export type InstallState = "pending" | "installing" | "ready" | "failed" | "custom" | "disabled";
export interface McpInstall { name: McpName; state: InstallState; message: string }

const states = new Map<McpName, McpInstall>((["linkedin", "chrome"] as const).map(name => [name, { name, state: "pending", message: "Waiting to check the installation." }]));
let listener: () => void = () => {};

export function installStates(): McpInstall[] { return [...states.values()]; }
export function installState(name: McpName): McpInstall { return states.get(name)!; }
export function setInstall(name: McpName, state: InstallState, message: string): void {
  const current = states.get(name)!;
  if (current.state === state && current.message === message) return;
  states.set(name, { name, state, message });
  listener();
}
/** One listener: the backend announces every change as an `integrations` change. */
export function onInstallChange(next: () => void): void { listener = next; }
