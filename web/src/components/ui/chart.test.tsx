import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  ChartContainer,
  ChartLegendContent,
  ChartStyle,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { ChartContext, getPayloadConfigFromPayload, useChart, type ChartConfig } from "@/components/ui/chart-config"
import { MetricChart } from "@/components/metric-chart"

function Icon() {
  return <svg data-testid="series-icon" />
}
const config: ChartConfig = {
  views: { label: "Profile views", color: "red" },
  searches: { label: "Search appearances", theme: { light: "blue", dark: "navy" } },
  iconic: { label: "With icon", icon: Icon },
}
const payload = [
  { dataKey: "views", name: "views", value: 1200, color: "red", payload: { fill: "pink" } },
  { dataKey: "searches", name: "searches", value: "12", color: "blue", payload: {} },
  { dataKey: "hidden", name: "hidden", value: 1, type: "none" as const, payload: {} },
]
function tooltip(props: Partial<React.ComponentProps<typeof ChartTooltipContent>> = {}) {
  return render(
    <ChartContext.Provider value={{ config }}>
      <ChartTooltipContent active payload={payload as never} label="views" {...props} />
    </ChartContext.Provider>,
  )
}

describe("chart primitives", () => {
  it("wraps charts with an identifiable container", () => {
    const { container } = render(
      <ChartContainer config={config} id="views">
        <div />
      </ChartContainer>,
    )
    expect(container.querySelector("[data-chart=chart-views]")).not.toBeNull()
  })

  it("writes theme and color variables and skips series without colors", () => {
    const { container } = render(<ChartStyle id="chart-a" config={config} />)
    const css = container.querySelector("style")?.innerHTML ?? ""
    expect(css).toContain("--color-views: red;")
    expect(css).toContain("--color-searches: blue;")
    expect(css).toContain(".dark [data-chart=chart-a]")
    expect(css).toContain("--color-searches: navy;")
    expect(css).not.toContain("--color-iconic")
    expect(render(<ChartStyle id="empty" config={{ plain: { label: "Plain" } }} />).container).toBeEmptyDOMElement()
  })

  it("renders tooltip labels, values and visible series", () => {
    tooltip()
    expect(screen.getAllByText("Profile views")).toHaveLength(2)
    expect(screen.getByText("Search appearances")).toBeInTheDocument()
    expect(screen.getByText((1200).toLocaleString())).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.queryByText("hidden")).not.toBeInTheDocument()
  })

  it("supports custom formatters, hidden labels and indicators", () => {
    const { unmount } = tooltip({
      labelFormatter: (value) => `Label: ${String(value)}`,
      formatter: (value, name) => <span>{`${name}=${value}`}</span>,
    })
    expect(screen.getByText("Label: Profile views")).toBeInTheDocument()
    expect(screen.getByText("views=1200")).toBeInTheDocument()
    unmount()
    const hidden = tooltip({ hideLabel: true, hideIndicator: true, indicator: "line" })
    expect(screen.getAllByText("Profile views")).toHaveLength(1)
    expect(hidden.container.querySelector(".shrink-0")).toBeNull()
    hidden.unmount()
    const dashed = tooltip({ indicator: "dashed", payload: [payload[0]] as never, labelKey: "views", nameKey: "views", color: "green" })
    expect(dashed.container.querySelector(".border-dashed")).toHaveStyle({ "--color-bg": "green" })
    expect(screen.getAllByText("Profile views")).toHaveLength(2)
  })

  it("renders configured icons and returns nothing for inactive tooltips", () => {
    const { unmount } = tooltip({ payload: [{ dataKey: "iconic", name: "iconic", value: 3, payload: {} }] as never, label: undefined })
    expect(screen.getByTestId("series-icon")).toBeInTheDocument()
    unmount()
    const inactive = tooltip({ active: false })
    expect(inactive.container.querySelector(".grid")).toBeNull()
    inactive.unmount()
    const empty = tooltip({ payload: [], label: "unknown" })
    expect(empty.container.querySelector(".grid")).toBeNull()
    empty.unmount()
    tooltip({ label: "unknown", labelKey: "missing", payload: [{ dataKey: "other", value: 1, payload: {} }] as never })
    expect(screen.queryByText("unknown")).not.toBeInTheDocument()
  })

  it("renders legends with icons, colors and alignment", () => {
    const legend = [
      { dataKey: "views", value: "views", color: "red" },
      { dataKey: "iconic", value: "iconic", color: "blue" },
      { dataKey: "none", value: "none", type: "none" as const },
    ]
    const { container, rerender } = render(
      <ChartContext.Provider value={{ config }}>
        <ChartLegendContent payload={legend as never} verticalAlign="top" />
      </ChartContext.Provider>,
    )
    expect(screen.getByText("Profile views")).toBeInTheDocument()
    expect(screen.getByTestId("series-icon")).toBeInTheDocument()
    expect(container.querySelector(".pb-3")).not.toBeNull()
    rerender(
      <ChartContext.Provider value={{ config }}>
        <ChartLegendContent payload={legend as never} hideIcon nameKey="dataKey" />
      </ChartContext.Provider>,
    )
    expect(screen.queryByTestId("series-icon")).not.toBeInTheDocument()
    expect(container.querySelector(".pt-3")).not.toBeNull()
    rerender(
      <ChartContext.Provider value={{ config }}>
        <ChartLegendContent payload={[]} />
      </ChartContext.Provider>,
    )
    expect(container.querySelector(".pt-3")).toBeNull()
  })

  it("resolves configuration keys from payload fields", () => {
    expect(getPayloadConfigFromPayload(config, null, "views")).toBeUndefined()
    expect(getPayloadConfigFromPayload(config, { series: "views" }, "series")).toBe(config.views)
    expect(getPayloadConfigFromPayload(config, { payload: { series: "searches" } }, "series")).toBe(config.searches)
    expect(getPayloadConfigFromPayload(config, { payload: null }, "views")).toBe(config.views)
  })

  it("requires a chart container", () => {
    function Consumer() {
      useChart()
      return null
    }
    expect(() => render(<Consumer />)).toThrow("useChart must be used within a <ChartContainer />")
  })

  it("renders metric history, a single measurement or an empty state", () => {
    const first = { captured_at: "2026-01-01", profile_views: 2, search_appearances: 3, score: 40 }
    const { container, unmount } = render(
      <MetricChart rows={[first, { ...first, captured_at: "2026-02-01", profile_views: 5 }]} />,
    )
    expect(container.querySelector("[data-slot=chart]")).not.toBeNull()
    unmount()
    const single = render(<MetricChart rows={[first]} />)
    expect(single.container.querySelector("[data-slot=chart]")).toBeNull()
    expect(screen.getByText("Search appearances").nextElementSibling).toHaveTextContent("3")
    expect(screen.getByRole("button", { name: "Measure again" })).toBeInTheDocument()
    single.unmount()
    render(<MetricChart rows={[]} />)
    expect(screen.getByText("Your progress starts here")).toBeInTheDocument()
  })
})
