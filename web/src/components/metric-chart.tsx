import { Area, AreaChart, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Empty } from "@/components/workspace-ui"
import { Button } from "@/components/ui/button"
import { prepareSkill } from "@/lib/agent"
import { date, text, type Row } from "@/lib/api"

/** One measurement is a point, not a trend: its numbers and a way to measure again. */
function SingleMeasurement({ row }: { row: Row }) {
  const values: [string, unknown][] = [["Profile views", row.profile_views], ["Search appearances", row.search_appearances], ["Score", row.score]]
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-4">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-medium tabular-nums">{text(value ?? 0)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">Measured {date(row.captured_at)}. Measure again to see the trend.</p>
        <Button size="sm" variant="outline" onClick={() => prepareSkill("profile-optimizer")}>Measure again</Button>
      </div>
    </div>
  )
}

export function MetricChart({ rows }: { rows: Row[] }) {
  if (!rows.length)
    return (
      <Empty
        title="Your progress starts here"
        description="Run a profile audit to begin tracking visibility over time."
      />
    )
  if (rows.length === 1) return <SingleMeasurement row={rows[0]} />
  return (
    <ChartContainer
      className="h-64 w-full aspect-auto"
      config={{
        profile_views: { label: "Profile views", color: "var(--chart-1)" },
        search_appearances: {
          label: "Search appearances",
          color: "var(--chart-4)",
        },
      }}
    >
      <AreaChart
        data={rows}
        margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
        accessibilityLayer
      >
        <XAxis
          dataKey="captured_at"
          tickFormatter={(v) =>
            new Date(v).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          }
          axisLine={false}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis width={35} axisLine={false} tickLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="search_appearances"
          stroke="var(--color-search_appearances)"
          fill="var(--color-search_appearances)"
          fillOpacity={0.12}
          connectNulls={false}
        />
        <Area
          type="monotone"
          dataKey="profile_views"
          stroke="var(--color-profile_views)"
          fill="var(--color-profile_views)"
          fillOpacity={0.15}
          connectNulls={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
