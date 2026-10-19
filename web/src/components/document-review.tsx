import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/ui/select-control"
import { Panel, Field, controlClass } from "@/components/workspace-ui"
import { documentDiff } from "@/lib/document-diff"
import type { DocumentVersion } from "../../../src/preparation/types"

export function DocumentReview({ version, versions, disabled, approve }: { version: DocumentVersion; versions: DocumentVersion[]; disabled: boolean; approve: () => void }) {
  const [comparison, setComparison] = useState("base")
  const other = versions.find(item => item.id === comparison)
  const changes = documentDiff(other?.text ?? version.baseText, version.text)
  return <div id="document-review"><Panel title="Document review">
    <p className="text-sm">Version {version.id.slice(0, 8)} · {version.submittedAt ? "Submitted" : version.usedAt ? "Used in portal" : version.approvedAt ? "Approved" : "Awaiting approval"}</p>
    <p className="mt-1 break-all text-xs text-muted-foreground">PDF SHA-256: {version.pdfHash}</p>
    {version.approvedAt && <p className="text-xs">Approved on {new Date(version.approvedAt).toLocaleString()}</p>}
    {version.usedAt && <p className="text-xs">Used in portal on {new Date(version.usedAt).toLocaleString()}</p>}
    {version.submittedAt && <p className="text-xs">Submitted on {new Date(version.submittedAt).toLocaleString()}</p>}
    <div className="my-3"><Field label="Compare document with"><SelectControl className={controlClass} value={other ? comparison : "base"} onChange={event => setComparison(event.target.value)}><option value="base">Base PDF from this generation</option>{versions.filter(item => item.applicationId === version.applicationId && item.id !== version.id).map(item => <option key={item.id} value={item.id}>Version {item.id.slice(0, 8)} · {new Date(item.createdAt).toLocaleString()}</option>)}</SelectControl></Field></div>
    <p className="mb-2 text-xs">Text extracted from the PDFs. Additions are marked +; removals are marked −.</p>
    <div aria-label="Document text comparison" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-sm">{changes.map((change, index) => <div key={index}>{change.kind === "added" ? <ins className="bg-green-500/15 no-underline">+ {change.text}</ins> : change.kind === "removed" ? <del className="bg-red-500/15">− {change.text}</del> : <span>{change.text}</span>}</div>)}</div>
    <details className="my-3 text-sm"><summary className="cursor-pointer">Inputs used for this version</summary><p className="mt-2 break-all text-xs">Sources: {version.sourceVersion}</p><p className="mt-2 whitespace-pre-wrap">{version.description}</p>{version.extra && <p className="mt-2 whitespace-pre-wrap">{version.extra}</p>}<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(version.data, null, 2)}</pre></details>
    <Button variant="outline" disabled={disabled || !!version.approvedAt} onClick={approve}>{version.approvedAt ? "Version approved" : "Approve this version"}</Button>
  </Panel></div>
}
