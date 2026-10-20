import { useEffect, useState } from "react"
import { request, useApi, useConnection } from "@/lib/api"
import type { PermissionRequest, PermissionSnapshot } from "@/lib/permissions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SelectControl } from "@/components/ui/select-control"
import { useSubmit } from "@/components/form-dialog"
import { Field, controlClass } from "@/components/workspace-ui"

function PermissionDialog({ permission, close }: { permission: PermissionRequest; close: () => void }) {
  const [remember, setRemember] = useState("once")
  const action = useSubmit()
  function answer(optionId?: string) {
    void action.submit(async () => {
      const option = permission.options.find(o => o.optionId === optionId)
      await request("acp/permissions/answer", { id: permission.id, runId: permission.runId, sessionId: permission.sessionId, optionId, remember: option?.kind.startsWith("allow_") ? remember : "once" })
      close()
    })
  }
  return <Dialog open modal={false} onOpenChange={open => { if (!open && !action.busy) close() }}>
    <DialogContent showCloseButton={!action.busy} className="max-h-[85vh] overflow-y-auto" onInteractOutside={e => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Agent tool permission</DialogTitle>
        <DialogDescription>Waiting for your decision. Tool approval does not confirm sending an application.</DialogDescription>
      </DialogHeader>
      <p className="break-words font-medium">{permission.title}</p>
      <p className="text-xs text-muted-foreground">Agent: {permission.provider} · Expires {new Date(permission.expiresAt).toLocaleTimeString()}</p>
      <details><summary className="cursor-pointer text-sm">Request context</summary><p className="break-all text-xs">Run: {permission.runId} · Session: {permission.sessionId}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{permission.context}</pre></details>
      {permission.rememberable && <Field label="Remember this tool">
        <SelectControl value={remember} onChange={e => setRemember(e.target.value)} className={controlClass} disabled={action.busy}>
          <option value="once">Ask every time</option>
          <option value="session">Allow for this session</option>
          <option value="persistent">Add to allowlist</option>
        </SelectControl>
      </Field>}
      {action.error && <p role="alert">{action.error}</p>}
      {action.busy && <p role="status">Saving decision…</p>}
      <div className="flex flex-wrap gap-2">
        {permission.options.map(option => <Button key={option.optionId} disabled={action.busy} variant={option.kind.startsWith("allow_") ? "default" : "outline"} onClick={() => answer(option.optionId)}>{option.name}</Button>)}
        <Button variant="outline" disabled={action.busy} onClick={() => answer()}>Cancel request</Button>
        <Button variant="ghost" disabled={action.busy} onClick={close}>Decide later</Button>
      </div>
    </DialogContent>
  </Dialog>
}

export function reviewPermission(runId: string) { window.dispatchEvent(new CustomEvent("review-agent-permission", { detail: runId })) }

export function AgentPermissions() {
  const api = useApi<PermissionSnapshot>("acp/permissions")
  const live = useConnection()
  const [hidden, setHidden] = useState<string[]>([])
  useEffect(() => {
    const review = (event: Event) => {
      const request = api.data?.pending.find(item => item.runId === (event as CustomEvent<string>).detail)
      if (request) setHidden(ids => ids.filter(id => id !== request.id))
    }
    window.addEventListener("review-agent-permission", review)
    return () => window.removeEventListener("review-agent-permission", review)
  }, [api.data])
  const permission = live ? api.data?.pending?.[0] : undefined
  if (live && api.error) return <div role="alert" className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm"><span>Could not load tool permissions: {api.error}</span><Button size="sm" variant="outline" onClick={api.refresh}>Retry permissions</Button></div>
  if (!permission) return null
  return <>
    <div role="status" className="flex items-center justify-between gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm">
      <span>Waiting for decision: {permission.title}</span>
      <Button size="sm" variant="outline" onClick={() => setHidden(hidden.filter(id => id !== permission.id))}>Review permission</Button>
    </div>
    {!hidden.includes(permission.id) && <PermissionDialog key={permission.id} permission={permission} close={() => { setHidden(ids => [...ids, permission.id]); api.refresh() }} />}
  </>
}
