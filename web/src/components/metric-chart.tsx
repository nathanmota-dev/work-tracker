import { Area, AreaChart, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Empty } from "@/components/workspace-ui"
import type { Row } from "@/lib/api"
export function MetricChart({ rows }: { rows: Row[] }) {
  if (!rows.length)
    return (
      <Empty
        title="Your progress starts here"
        description="Run a profile audit to begin tracking visibility over time."
      />
    )
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
