import { AgentIndicator } from "@/components/agent-indicator"
import { setAgentPanelOpen } from "@/lib/agent"
import { useWorkspaceLinks } from "@/lib/workspace-state"
import { Link, useMatchRoute } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCommandPalette } from "@/components/command-palette"
import logo from "@/public/logo.png"
import { navigationGroups } from "@/routes/navigation-items"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const { openSearch, shortcut } = useCommandPalette()

  return (
    <Sidebar variant="inset" collapsible="icon" aria-label="Navegação principal">
      <SidebarHeader className="gap-4 px-0 pb-0 pt-2">
        <div className="flex h-8 items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:flex-none">
            <img src={logo} alt="Logo" className="size-5 shrink-0" />
            <span className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">WorkTracker</span>
          </div>
          <SidebarTrigger
            aria-label="Alternar sidebar"
            className="size-8 shrink-0 rounded-lg text-muted-foreground group-data-[collapsible=icon]:hidden"
          />
        </div>
        <Button
          variant="outline"
          aria-label="Buscar na navegação"
          aria-haspopup="dialog"
          className="h-8 w-full cursor-pointer justify-start gap-2 rounded-lg px-2.5 text-xs font-normal text-muted-foreground shadow-xs group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          onClick={openSearch}
        >
          <Search className="size-3.5" strokeWidth={1.7} />
          <span className="truncate group-data-[collapsible=icon]:hidden">Search anything...</span>
          <kbd className="ml-auto shrink-0 rounded border px-1 text-[10px] group-data-[collapsible=icon]:hidden">{shortcut}</kbd>
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-0 pt-4">
        {navigationGroups.filter((group) => !group.footer).map((group) => (
          <NavigationGroup key={group.title} group={group} />
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t px-0 pb-1 pt-2">
        {navigationGroups.filter((group) => group.footer).map((group) => (
          <NavigationGroup key={group.title} group={group} />
        ))}
      </SidebarFooter>
    </Sidebar>
  )
}

function NavigationGroup({ group }: { group: (typeof navigationGroups)[number] }) {
  const remembered = useWorkspaceLinks()
  const matchRoute = useMatchRoute()
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup key={group.title} className="p-0" role="group" aria-label={group.title}>
      {!group.footer && <SidebarGroupLabel>{group.title}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu aria-label={group.title}>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.to} className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
              <SidebarMenuButton
                asChild
                isActive={Boolean(matchRoute({ to: item.to, fuzzy: true }))}
                tooltip={item.title}
                className="rounded-lg font-normal data-[active=true]:font-normal [&>svg]:stroke-[1.7]"
              >
                <Link
                  to={item.to}
                  search={remembered[item.to] ?? {}}
                  aria-label={item.title}
                  className="cursor-pointer"
                  activeProps={{ "aria-current": "page" }}
                  onClick={() => setOpenMobile(false)}
                >
                  <item.icon />
                  <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.to === "/launch" && <button type="button" aria-label="Open agent task" onClick={() => { setOpenMobile(false); setAgentPanelOpen(true) }} className="absolute right-1 top-0.5 rounded px-2 py-1 hover:bg-muted focus-visible:outline-2 group-data-[collapsible=icon]:right-0 group-data-[collapsible=icon]:top-0 group-data-[collapsible=icon]:p-0.5"><AgentIndicator /></button>}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
