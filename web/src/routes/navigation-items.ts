import { Home, Settings } from "lucide-react"
import { workspacePages } from "@/routes/workspace-pages"

const pages = [
  { to: "/dashboard", title: "Dashboard", icon: Home },
  ...workspacePages.map((page) => ({
    to: `/${page.path}` as const,
    title: page.title,
    icon: page.icon,
  })),
  { to: "/settings", title: "Settings", icon: Settings },
] as const


// This order is shared by the sidebar and page search.
export const navigationGroups = [
  { title: "Overview", paths: ["/dashboard"], footer: false },
  { title: "Journey", paths: ["/jobs", "/applications", "/interviews", "/interview-prep", "/contacts"], footer: false },
  { title: "You", paths: ["/profile", "/resumes"], footer: false },
  { title: "Tools", paths: ["/launch", "/settings"], footer: true },
].map(({ paths, ...group }) => ({
  ...group,
  items: paths.map((path) => pages.find((page) => page.to === path)!),
}))

export const navigationItems = navigationGroups.flatMap((group) => group.items)
