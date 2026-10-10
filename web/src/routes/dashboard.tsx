import { DashboardOverview } from "@/components/dashboard-overview"

export function Dashboard() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <h1 className="text-base font-medium">Dashboard</h1>
      <DashboardOverview />
    </div>
  )
}
