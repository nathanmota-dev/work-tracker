import { Outlet } from "@tanstack/react-router"
import { AppSidebar } from "@/components/app-sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { ThemeProvider } from "@/components/theme-provider"
import { RouteBreadcrumb } from "@/layout/route-breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export function MainLayout() {
  return (
    <ThemeProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden bg-background">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden border border-border shadow-xs">
          <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger aria-label="Abrir sidebar" className="md:hidden" />
            <RouteBreadcrumb />
            <ModeToggle />
          </header>
          <div className="flex min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  )
}
