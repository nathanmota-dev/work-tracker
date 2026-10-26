import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync } from "node:fs"
import type { Plugin } from "vite"

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))
// Package PDF.js resources and serve the same paths during development.
const pdfResources = new Map<string, Buffer>(["cmaps", "standard_fonts", "wasm"].flatMap(directory =>
  readdirSync(resolve(pdfjsRoot, directory)).filter(name => statSync(resolve(pdfjsRoot, directory, name)).isFile())
    .map(name => [`/pdfjs/${directory}/${name}`, readFileSync(resolve(pdfjsRoot, directory, name))] as const),
))
export const pdfAssets: Plugin = {
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
