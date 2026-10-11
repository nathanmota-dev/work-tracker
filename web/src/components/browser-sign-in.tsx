import { useState } from "react"
import { Globe, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/workspace-ui"
import { request } from "@/lib/api"

export function BrowserSignIn() {
  const [opening, setOpening] = useState(false)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState("")
  async function open() {
    setOpening(true)
    setOpened(false)
    setError("")
    try {
      await request("browser/login", {})
      setOpened(true)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setOpening(false)
    }
  }
  return (
    <Panel title="Browser sign-in">
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Open your Work Tracker browser and sign in to LinkedIn or Google.
        Keep this window open while your agent works.
      </p>
      <Button variant="outline" size="sm" onClick={open} disabled={opening}>
        {opening ? <LoaderCircle className="size-4 animate-spin" /> : <Globe className="size-4" />}
        {opening ? "Opening browser…" : "Open sign-in browser"}
      </Button>
      {opened && <p role="status" className="mt-3 text-sm text-muted-foreground">
        Complete sign-in in Chrome, then start your agent. LinkedIn profile reads may ask for a separate sign-in in another window.
      </p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </Panel>
  )
}
