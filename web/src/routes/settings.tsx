import { ResumeSources } from "@/components/resume-sources"
import { PermissionSettings } from "@/components/permission-settings"
import { BrowserSignIn } from "@/components/browser-sign-in"
import { IntegrationSettingsPanel } from "@/components/integration-settings"
import { WorkspaceBackup } from "@/components/workspace-backup"
import { AppUpdates } from "@/components/app-updates"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SelectControl } from "@/components/ui/select-control"
import { EffortSlider } from "@/components/ui/effort-slider"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import {
  Page,
  Panel,
  Field,
  controlClass,
  LoadState,
  Status,
} from "@/components/workspace-ui"
import { useApi, useConnection } from "@/lib/api"
import type { Providers } from "@/lib/agent"
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

function useAgentPreferences() {
  const api = useApi<Providers>("acp/providers")
  const [provider, setProvider] = useState(
    localStorage.getItem("work-tracker-provider") ?? "",
  )
  const [model, setModel] = useState(
    localStorage.getItem("work-tracker-model") ?? "",
  )
  const [effort, setEffort] = useState(
    localStorage.getItem("work-tracker-effort") ?? "",
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  return { api, provider, setProvider, model, setModel, effort, setEffort, saved, setSaved, error, setError }
}

function AgentPreferences({ preferences }: { preferences: ReturnType<typeof useAgentPreferences> }) {
  const { api, provider, setProvider, model, setModel, effort, setEffort, saved, setSaved, error, setError } = preferences
  const selected = api.data?.providers.find((p) => p.id === provider)
  return (
    <Panel title="Agent preferences">
      <p className="mb-4 text-sm text-muted-foreground">
        Default selections for new runs on this device.
      </p>
      <LoadState {...api} retry={api.refresh} />
      {api.data && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            setSaved(false)
            if ((provider && !selected) || (model && !selected?.models.includes(model)) || (effort && !selected?.efforts?.includes(effort))) { setError("Choose an available agent, model and effort before saving preferences."); return }
            setError("")
            localStorage.setItem("work-tracker-provider", provider)
            localStorage.setItem("work-tracker-model", model)
            localStorage.setItem("work-tracker-effort", effort)
            setSaved(true)
          }}
        >
          <Field label="Preferred agent">
            <SelectControl
              className={controlClass}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value)
                setModel("")
                setEffort("")
                setSaved(false)
              }}
            >
              <option value="">
                Workspace default ({api.data.default})
              </option>
              {api.data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </SelectControl>
          </Field>
          <Field label="Preferred model">
            <SelectControl
              className={controlClass}
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setSaved(false)
              }}
            >
              <option value="">Provider default</option>
              {selected?.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </SelectControl>
          </Field>
          {!!selected?.efforts?.length && <EffortSlider
            label="Preferred effort"
            levels={selected.efforts}
            value={effort}
            onChange={(level) => {
              setEffort(level)
              setSaved(false)
            }}
          />}
          <Button size="sm">Save preferences</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Preferences saved.
            </p>
          )}
        </form>
      )}
    </Panel>
  )
}

export function SettingsPage() {
  const preferences = useAgentPreferences()
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
            <AgentPreferences preferences={preferences} />
            <BrowserSignIn />
          </div>
        </TabsContent>
        <TabsContent value="resume"><ResumeSources /></TabsContent>
        <TabsContent value="integrations"><div className="flex flex-col gap-4"><IntegrationSettingsPanel /><BrowserSignIn /></div></TabsContent>
        <TabsContent value="permissions"><PermissionSettings /></TabsContent>
        <TabsContent value="backup"><WorkspaceBackup /></TabsContent>
        <TabsContent value="updates"><AppUpdates /></TabsContent>
      </Tabs>
    </Page>
  )
}
