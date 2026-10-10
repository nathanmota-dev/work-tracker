import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Outlet, RouterProvider } from "@tanstack/react-router"
import { Home } from "lucide-react"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { createAppRouter } from "@/router"
import "./index.css"

function MainLayout() {
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden bg-white">
      <AppSidebar />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden border border-border shadow-xs">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger aria-label="Abrir sidebar" className="md:hidden" />
          <Home className="size-4 text-muted-foreground" strokeWidth={1.7} />
          <h1 className="text-sm font-medium">Dashboard</h1>
        </header>
        <div className="flex min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

const router = createAppRouter(MainLayout)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
