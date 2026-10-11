import { SettingsProfile } from "@/components/settings-profile"
import { BrowserSignIn } from "@/components/browser-sign-in"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SelectControl } from "@/components/ui/select-control"
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
export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const live = useConnection()
  const api = useApi<Providers>("acp/providers")
  const [provider, setProvider] = useState(
    localStorage.getItem("work-tracker-provider") ?? "",
  )
  const [model, setModel] = useState(
    localStorage.getItem("work-tracker-model") ?? "",
  )
  const [saved, setSaved] = useState(false)
  const selected = api.data?.providers.find((p) => p.id === provider)
  return (
    <Page title="Settings" description="A workspace that feels like yours.">
      <Tabs defaultValue="general">
        <TabsList aria-label="Settings views">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <div className="grid gap-4 lg:grid-cols-2">
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
                    localStorage.setItem("work-tracker-provider", provider)
                    localStorage.setItem("work-tracker-model", model)
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
                  <Button size="sm">Save preferences</Button>
                  {saved && (
                    <p role="status" className="text-sm text-muted-foreground">
                      Preferences saved.
                    </p>
                  )}
                </form>
              )}
            </Panel>
            <BrowserSignIn />
          </div>
        </TabsContent>
        <TabsContent value="profile">
          <SettingsProfile />
        </TabsContent>
      </Tabs>
    </Page>
  )
}
