import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

/** An arrow back to `href`, shown left of a page title; `label` names the destination for screen readers. */
export function BackButton({ href, label }: { href: string; label: string }) {
  return <Button asChild variant="ghost" size="icon-sm" className="-ml-2 shrink-0 text-muted-foreground hover:text-foreground">
    <a href={href} aria-label={label} title={label}><ArrowLeft /></a>
  </Button>
}
