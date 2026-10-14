import { resolve, dirname } from "node:path"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync } from "node:fs"
import type { Plugin } from "vite"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))
// Package PDF.js resources and serve the same paths during development.
const pdfResources = new Map<string, Buffer>(["cmaps", "standard_fonts", "wasm"].flatMap(directory =>
  readdirSync(resolve(pdfjsRoot, directory)).filter(name => statSync(resolve(pdfjsRoot, directory, name)).isFile())
    .map(name => [`/pdfjs/${directory}/${name}`, readFileSync(resolve(pdfjsRoot, directory, name))] as const),
))
const pdfAssets: Plugin = {
  name: "work-tracker-pdf-assets",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split("?")[0] ?? ""
      const data = pdfResources.get(path)
      if (!data) return next()
      response.setHeader("content-type", path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream")
      response.end(data)
    })
  },
  generateBundle() { for (const [path, source] of pdfResources) this.emitFile({ type: "asset", fileName: path.slice(1), source }) },
}
const root = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  main: {
    // Retain a reference to local sources when launched from the applications menu.
    // Personal LaTeX/data files are read at runtime and are not bundled.
    define: { __WORK_TRACKER_REPO_ROOT__: JSON.stringify(resolve(root)) },
    build: {
      rollupOptions: {
        input: { index: resolve(root, "desktop/src/main.ts") },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(root, "desktop/src/preload.ts") },
      },
    },
  },
  renderer: {
    root: resolve(root, "web"),
    plugins: [react(), tailwindcss(), pdfAssets],
    resolve: {
      alias: { "@": resolve(root, "web/src") },
    },
    server: { host: "127.0.0.1" },
    build: {
      rollupOptions: { input: resolve(root, "web/index.html") },
    },
  },
})
