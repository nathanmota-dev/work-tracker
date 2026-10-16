import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import {
  Sidebar, SidebarMenuButton, SidebarMenuSubButton, SidebarProvider,
  SidebarRail, SidebarTrigger, useSidebar,
} from "./sidebar"

afterEach(() => {
  vi.unstubAllGlobals()
})

it("toggles the desktop sidebar by trigger, rail, and keyboard shortcut", () => {
  vi.stubGlobal("innerWidth", 1024)
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon"><p>Navigation</p></Sidebar>
      <SidebarTrigger aria-label="Toggle navigation" />
      <SidebarRail />
    </SidebarProvider>,
  )
  expect(screen.getByText("Navigation").closest('[data-slot="sidebar"]')).toHaveAttribute("data-state", "expanded")
  fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }))
  expect(screen.getByText("Navigation").closest('[data-slot="sidebar"]')).toHaveAttribute("data-collapsible", "icon")
  fireEvent.keyDown(window, { key: "b", ctrlKey: true })
  expect(screen.getByText("Navigation").closest('[data-slot="sidebar"]')).toHaveAttribute("data-state", "expanded")
  fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
  expect(screen.getByText("Navigation").closest('[data-slot="sidebar"]')).toHaveAttribute("data-collapsible", "icon")
})

it("supports controlled state and non-collapsible sidebar rendering", () => {
  vi.stubGlobal("innerWidth", 1024)
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const onOpenChange = vi.fn()
  render(
    <SidebarProvider open={false} onOpenChange={onOpenChange}>
      <Sidebar collapsible="none"><p>Always open</p></Sidebar>
      <SidebarTrigger />
    </SidebarProvider>,
  )
  expect(screen.getByText("Always open").closest('[data-slot="sidebar"]')).not.toHaveAttribute("data-state")
  fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }))
  expect(onOpenChange).toHaveBeenCalledWith(true)
})

it("renders menu button tooltip modes and active sub-navigation variants", () => {
  vi.stubGlobal("innerWidth", 1024)
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(
    <SidebarProvider defaultOpen={false}>
      <SidebarMenuButton>Plain</SidebarMenuButton>
      <SidebarMenuButton tooltip="Collapsed help">Tooltip</SidebarMenuButton>
      <SidebarMenuButton asChild tooltip={{ children: "Object help" }}><a href="#target">Link child</a></SidebarMenuButton>
      <SidebarMenuSubButton size="sm" isActive href="#small">Small sublink</SidebarMenuSubButton>
      <SidebarMenuSubButton size="md" href="#medium">Medium sublink</SidebarMenuSubButton>
    </SidebarProvider>,
  )
  expect(screen.getByRole("button", { name: "Plain" })).toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Link child" })).toHaveAttribute("data-sidebar", "menu-button")
  expect(screen.getByRole("link", { name: "Small sublink" })).toHaveAttribute("data-active", "true")
  expect(screen.getByRole("link", { name: "Small sublink" })).toHaveAttribute("data-size", "sm")
  expect(screen.getByRole("link", { name: "Medium sublink" })).toHaveAttribute("data-size", "md")
})

it("requires a provider when sidebar context is accessed", () => {
  function Consumer() {
    useSidebar()
    return null
  }
  expect(() => render(<Consumer />)).toThrow("useSidebar must be used within a SidebarProvider.")
})
