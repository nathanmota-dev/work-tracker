import { Bar, BarChart, Rectangle, XAxis, YAxis, type BarShapeProps } from "recharts"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  invoiceStatuses,
  invoiceSummary,
  monthlyInvoices,
  upcomingInvoices,
} from "@/lib/dashboard-mocks"
import { cn } from "@/lib/utils"

const currencyFormatter = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
})

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

const chartConfig = {
  paid: { label: "Paid", color: "var(--chart-1)" },
  open: { label: "Open", color: "var(--chart-4)" },
} satisfies ChartConfig

const invoiceTotal = invoiceStatuses.reduce((total, status) => total + status.amount, 0)

function PaidBar({ x, y, width, height, payload }: BarShapeProps) {
  const invoice = payload as (typeof monthlyInvoices)[number]

  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill="var(--color-paid)"
      radius={invoice.open > 0 ? [0, 0, 6, 6] : 6}
    />
  )
}

function OpenBar({ x, y, width, height, payload }: BarShapeProps) {
  const invoice = payload as (typeof monthlyInvoices)[number]

  return (
    <Rectangle
      x={x}
      y={y}
      width={width}
      height={height}
      fill="var(--color-open)"
      radius={invoice.paid > 0 ? [6, 6, 0, 0] : 6}
    />
  )
}

function StatusSplit() {
  return (
    <section aria-labelledby="status-split-title" className="mt-6">
      <h3 id="status-split-title" className="mb-3 text-sm font-medium">Status split</h3>
      <TooltipProvider>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {invoiceStatuses.map((status) => {
            const percentage = Math.round(status.amount / invoiceTotal * 100)

            return (
              <Tooltip key={status.label}>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    aria-label={`${status.label}: ${percentage}%, ${currencyFormatter.format(status.amount)}`}
                    className={cn("h-full min-w-0 transition-opacity hover:opacity-80 focus-visible:opacity-70", status.colorClass)}
                    style={{ flexGrow: status.amount, flexBasis: 0 }}
                  />
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>
                  {status.label} · {currencyFormatter.format(status.amount)}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {invoiceStatuses.map((status) => (
          <li key={status.label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", status.colorClass)} />
            {status.label} {Math.round(status.amount / invoiceTotal * 100)}%
          </li>
        ))}
      </ul>
    </section>
  )
}

function MonthlyInvoices() {
  return (
    <Card className="min-w-0 gap-0 rounded-2xl py-4 shadow-none">
      <CardHeader className="mb-5 flex flex-row flex-wrap items-center justify-between gap-2 px-4">
        <h2 id="monthly-invoices-title" className="text-sm font-medium">Invoiced by due month</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Chart legend">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-xs bg-chart-1" />Paid
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-xs bg-chart-4" />Open
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        <ChartContainer
          config={chartConfig}
          className="h-[208px] w-full aspect-auto"
          role="region"
          aria-labelledby="monthly-invoices-title"
          aria-description="Paid and open invoice amounts by due month. Use the arrow keys to explore each month."
        >
          <BarChart accessibilityLayer data={monthlyInvoices} barSize={28} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={8}
              height={28}
              tick={{ fontSize: 10 }}
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  className="min-w-44"
                  formatter={(value, name) => (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn("size-2 shrink-0 rounded-xs", name === "paid" ? "bg-chart-1" : "bg-chart-4")}
                      />
                      <span className="flex-1 text-muted-foreground">{name === "paid" ? "Paid" : "Open"}</span>
                      <span className="font-medium tabular-nums">{currencyFormatter.format(Number(value))}</span>
                    </>
                  )}
                />
              }
            />
            <Bar dataKey="paid" stackId="invoices" fill="var(--color-paid)" shape={PaidBar} />
            <Bar dataKey="open" stackId="invoices" fill="var(--color-open)" shape={OpenBar} />
          </BarChart>
        </ChartContainer>
        <StatusSplit />
      </CardContent>
    </Card>
  )
}

function UpcomingInvoices() {
  return (
    <Card className="min-w-0 gap-0 rounded-2xl py-4 shadow-none">
      <CardHeader className="mb-3 block px-4">
        <h2 className="text-sm font-medium">Due next</h2>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="space-y-0.5">
          {upcomingInvoices.map((invoice) => (
            <li key={invoice.name} className="flex min-h-[60px] items-center gap-3 py-2">
              <Avatar className="size-7" aria-hidden="true">
                <AvatarFallback className="border text-[10px] font-medium">
                  {invoice.name.split(" ").map((part) => part[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{invoice.name}</p>
                <time dateTime={invoice.date} className="block text-xs text-muted-foreground">
                  {dateFormatter.format(new Date(`${invoice.date}T00:00:00Z`))}
                </time>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="text-[13px] font-semibold tabular-nums">{currencyFormatter.format(invoice.amount)}</p>
                <Badge
                  variant="outline"
                  className={cn("h-5 rounded-md px-1.5 py-0 text-[11px] font-normal text-muted-foreground", invoice.status === "Pending" && "bg-muted/50")}
                >
                  {invoice.status}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function DashboardOverview() {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {invoiceSummary.map((summary) => (
          <Card key={summary.label} className="gap-0 rounded-2xl py-4 shadow-none">
            <CardContent className="px-4">
              <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                <span aria-hidden="true" className={cn("size-1.5 rounded-full", summary.colorClass)} />
                {summary.label}
              </p>
              <p className="text-[22px] font-semibold tracking-tight tabular-nums">{currencyFormatter.format(summary.amount)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{summary.count} invoices</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <MonthlyInvoices />
        <UpcomingInvoices />
      </div>
    </div>
  )
}
