import { useState } from "react"
import { CalendarClock, Copy, FileText, MoreHorizontal, RefreshCw, UsersRound, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Markdown } from "@/components/markdown"
import { CardBadge, CardLinkButton, shortDate } from "@/components/opportunity-card"
import { CardMeta, DetailsSheet, EntityCard, whenLabel } from "@/components/entity-card"
import { text, type Row } from "@/lib/api"
import { openApply } from "@/lib/preparation"

/** A stored pack with the company and role of its application. */
export type PrepPack = Row & { application?: Row }

const company = (pack: PrepPack) => text(pack.application?.company_name ?? "Application")
const role = (pack: PrepPack) => text(pack.application?.job_title ?? `Application #${text(pack.application_id)}`)

/** The pack's first lines of prose, without Markdown marks, as the card's preview. */
function preview(body: unknown) {
  return String(body ?? "").split("\n").filter(line => !/^\s*#/.test(line))
    .map(line => line.replace(/^\s*(?:[-*+>]|\d+\.)\s+/, "").replace(/[*_`]/g, "").trim()).filter(Boolean).join(" · ").slice(0, 200)
}

async function copy(pack: PrepPack) {
  await navigator.clipboard?.writeText(String(pack.body_md ?? "")).catch(() => {})
}

function PackMenu({ pack, onRebuild }: { pack: PrepPack; onRebuild: (pack: PrepPack) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${role(pack)} ${text(pack.stage)} pack`} className="text-muted-foreground"><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => void copy(pack)}><Copy /> Copy as Markdown</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRebuild(pack)}><RefreshCw /> Build again</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openApply(pack.application?.job_id, pack.application_id)}><FileText /> Open application</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PackCard({ pack, onOpen, onRebuild }: { pack: PrepPack; onOpen: () => void; onRebuild: (pack: PrepPack) => void }) {
  return (
    <EntityCard
      name={company(pack)}
      eyebrow={company(pack)}
      title={role(pack)}
      badges={<><CardBadge tone="primary">{text(pack.stage)}</CardBadge>{pack.format ? <CardBadge>{String(pack.format)}</CardBadge> : null}</>}
      meta={[
        pack.scheduled_at ? <CardMeta key="when" icon={CalendarClock}>{whenLabel(pack.scheduled_at)}</CardMeta> : null,
        pack.interviewers ? <CardMeta key="who" icon={UsersRound}>{String(pack.interviewers)}</CardMeta> : null,
      ]}
      menu={<PackMenu pack={pack} onRebuild={onRebuild} />}
      date={`Saved ${shortDate(pack.created_at)}`}
      action={<CardLinkButton label="Open pack" onClick={onOpen} />}
      onOpen={onOpen}
    >
      <p className="line-clamp-3 text-sm text-muted-foreground">{preview(pack.body_md) || "Empty pack"}</p>
    </EntityCard>
  )
}

export function PackSheet({ pack, onClose, onRebuild }: { pack: PrepPack | null; onClose: () => void; onRebuild: (pack: PrepPack) => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <DetailsSheet
      open={!!pack}
      title={pack ? `${role(pack)} · ${text(pack.stage)}` : ""}
      description={pack && [company(pack), pack.scheduled_at ? whenLabel(pack.scheduled_at) : `Saved ${shortDate(pack.created_at)}`].join(" · ")}
      onClose={() => { setCopied(false); onClose() }}
      actions={pack && <>
        <Button variant="outline" onClick={() => void copy(pack).then(() => setCopied(true))}><Copy /> {copied ? "Copied" : "Copy"}</Button>
        <Button variant="outline" onClick={() => onRebuild(pack)}><RefreshCw /> Build again</Button>
        <Button variant="ghost" onClick={() => openApply(pack.application?.job_id, pack.application_id)}><FileText /> Open application</Button>
      </>}
    >
      {pack && <>
        {(pack.format || pack.interviewers) && (
          <div className="flex flex-wrap gap-4">
            {pack.format ? <CardMeta icon={Video}>{String(pack.format)}</CardMeta> : null}
            {pack.interviewers ? <CardMeta icon={UsersRound}>{String(pack.interviewers)}</CardMeta> : null}
          </div>
        )}
        <div className="text-sm"><Markdown text={String(pack.body_md ?? "")} /></div>
      </>}
    </DetailsSheet>
  )
}
