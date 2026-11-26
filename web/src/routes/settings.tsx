import { ResumeSources } from "@/components/resume-sources"
import { PermissionSettings } from "@/components/permission-settings"
import { BrowserSignIn } from "@/components/browser-sign-in"
import { IntegrationSettingsPanel } from "@/components/integration-settings"
import { WorkspaceBackup } from "@/components/workspace-backup"
import { AppUpdates } from "@/components/app-updates"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useTheme } from "@/components/theme-provider"
import {
  Page,
  Panel,
  Status,
} from "@/components/workspace-ui"
import { useConnection } from "@/lib/api"
function AppearancePanel() {
  const { theme, setTheme } = useTheme()
  return (
    <Panel title="Appearance">
      <p className="mb-4 text-sm text-muted-foreground">
        Choose the theme that works best for you.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(["light", "dark"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
            className={`rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${theme === value ? "border-chart-1 ring-1 ring-chart-1" : "border-border"}`}
          >
            <div
              className={`mb-3 flex h-24 gap-2 rounded-md border p-2 ${value === "dark" ? "bg-zinc-900" : "bg-zinc-50"}`}
            >
              <div
                className={`w-1/4 rounded ${value === "dark" ? "bg-zinc-800" : "bg-zinc-200"}`}
              />
              <div className="flex flex-1 flex-col gap-2">
                <div
                  className={`h-3 rounded ${value === "dark" ? "bg-zinc-700" : "bg-zinc-200"}`}
                />
                <div
                  className={`flex-1 rounded ${value === "dark" ? "bg-zinc-800" : "bg-white"}`}
                />
              </div>
            </div>
            <span className="text-sm capitalize">{value}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

function ConnectionPanel() {
  const live = useConnection()
  return (
    <Panel title="Workspace connection">
      <div className="mb-3">
        <Status value={live ? "Connected" : "Disconnected"} />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Work Tracker connects to the local backend managed by the
        desktop app. Records refresh automatically when your workspace
        changes.
      </p>
      <p className="mt-4 text-xs text-muted-foreground">
        LinkedIn, Chrome MCP and provider credentials use your existing
        backend configuration.
      </p>
    </Panel>
  )
}

export function SettingsPage() {
  return (
    <Page title="Settings" description="A workspace that feels like yours.">
      <Tabs defaultValue={new URLSearchParams(window.location.hash.split("?")[1]).get("section") ?? "general"}>
        <TabsList aria-label="Settings views">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="resume">Resume sources</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="backup">Backup</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <div className="grid gap-4 lg:grid-cols-2">
            <AppearancePanel />
            <ConnectionPanel />
            <BrowserSignIn />
          </div>
        </TabsContent>
        <TabsContent value="resume"><ResumeSources /></TabsContent>
        <TabsContent value="integrations"><div className="flex flex-col gap-4"><IntegrationSettingsPanel scope="mcp" /><BrowserSignIn /></div></TabsContent>
        <TabsContent value="permissions"><PermissionSettings /></TabsContent>
        <TabsContent value="backup"><WorkspaceBackup /></TabsContent>
        <TabsContent value="updates"><AppUpdates /></TabsContent>
      </Tabs>
    </Page>
  )
}
