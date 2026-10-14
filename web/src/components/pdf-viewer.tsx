import { useEffect, useMemo, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import { Button } from "@/components/ui/button"
import { Download, Minus, Plus } from "lucide-react"
import { Empty, Panel } from "@/components/workspace-ui"
import type { PdfArtifact } from "@/lib/preparation"
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
const pdfAssets = new URL("./pdfjs/", document.baseURI).href
const pdfOptions = { cMapUrl: `${pdfAssets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${pdfAssets}standard_fonts/`, wasmUrl: `${pdfAssets}wasm/` }
export function PdfViewer({ title, artifact }: { title: string; artifact?: PdfArtifact | null }) {
  const [bytes, setBytes] = useState<Uint8Array>()
  const [error, setError] = useState("")
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(400)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) setWidth(Math.max(200, w - 20)) })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    setBytes(undefined); setError(""); setPage(1); setPages(0)
    if (artifact) window.desktop?.readPdf(artifact.id).then(buffer => { if (active) setBytes(new Uint8Array(buffer)) }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [artifact?.id])
  const file = useMemo(() => bytes ? { data: bytes } : undefined, [bytes])
  return <Panel title={title} action={artifact && <Button size="icon-sm" variant="outline" aria-label={`Download ${title}`} onClick={() => void window.desktop?.savePdf(artifact.id).catch(e => setError(e.message))}><Download /></Button>}>
    {artifact && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
      <span>{page} / {pages || artifact.pages}</span>
      <Button variant="outline" size="sm" disabled={page >= (pages || artifact.pages)} onClick={() => setPage(p => p + 1)}>Next</Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Zoom out ${title}`} onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}><Minus /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Zoom in ${title}`} onClick={() => setZoom(z => Math.min(2, z + 0.1))}><Plus /></Button>
      <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>Fit width</Button>
    </div>}
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    <div ref={container} className="h-[580px] overflow-auto rounded-lg border bg-muted/30 p-2">
      {!artifact ? <Empty title="No PDF yet" description="Generate a resume or update the base preview to see it here." /> : !file ? <p role="status" className="p-4 text-sm">Loading PDF…</p> : <Document file={file} options={pdfOptions} suspense={false} onLoadSuccess={({ numPages }) => setPages(numPages)} onLoadError={e => setError(e.message)} loading={<p className="p-4 text-sm">Loading PDF…</p>}><Page pageNumber={page} width={Math.floor(width * zoom)} onRenderError={e => setError(e.message)} /></Document>}
    </div>
    {!!artifact?.warnings.length && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{artifact.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
  </Panel>
}
