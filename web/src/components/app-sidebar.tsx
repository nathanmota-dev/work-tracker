import { useState } from "react"
import { Link, useMatchRoute } from "@tanstack/react-router"
import { Home, Search, Settings } from "lucide-react"
import { Input } from "@/components/ui/input"
import logo from "@/public/logo.png"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const [search, setSearch] = useState("")
  const matchRoute = useMatchRoute()
  const { setOpenMobile } = useSidebar()
  const showDashboard = "dashboard".includes(search.trim().toLowerCase())

  return (
    <Sidebar variant="inset" collapsible="icon" aria-label="Navegação principal">
      <SidebarHeader className="gap-4 px-0 pb-0 pt-2">
        <div className="flex h-8 items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:hidden">
            <img src={logo} alt="Logo" className="size-5 shrink-0" />
            <span className="truncate text-sm font-medium">WorkTracker</span>
          </div>
          <SidebarTrigger
            aria-label="Alternar sidebar"
            className="size-8 shrink-0 rounded-lg text-muted-foreground"
          />
        </div>
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.7}
          />
          <Input
            type="search"
            aria-label="Buscar na navegação"
            placeholder="Search anything..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 rounded-lg bg-white pl-8 text-xs shadow-xs md:text-xs"
          />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 pt-4">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu aria-label="Páginas">
              {showDashboard && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={Boolean(matchRoute({ to: "/dashboard" }))}
                    tooltip="Dashboard"
                    className="rounded-lg font-normal data-[active=true]:font-normal [&>svg]:stroke-[1.7]"
                  >
                    <Link
                      to="/dashboard"
                      activeProps={{ "aria-current": "page" }}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Home />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t px-0 pb-1 pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled
              tooltip="Settings — em breve"
              title="Settings — em breve"
              className="rounded-lg text-muted-foreground disabled:opacity-70 [&>svg]:stroke-[1.7]"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
