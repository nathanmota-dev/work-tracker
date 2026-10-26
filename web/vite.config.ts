import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ProxyOptions } from "vite"
import { pdfAssets } from "./vite.pdf-assets"
import pkg from "../package.json" with { type: "json" }

const root = fileURLToPath(new URL(".", import.meta.url))
/** Backend that the development server forwards the API and socket to. */
const backend = process.env.WORK_TRACKER_DEV_BACKEND ?? "http://127.0.0.1:47830"
// The backend only trusts its own origin; the development page is another one.
const proxy = (target: string, ws = false): ProxyOptions => ({
  target,
  ws,
  changeOrigin: true,
  configure: (server) => {
    server.on("proxyReq", (request) => request.setHeader("origin", backend))
    server.on("proxyReqWs", (request) => request.setHeader("origin", backend))
  },
})

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), pdfAssets],
  resolve: { alias: { "@": resolve(root, "src") } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  cacheDir: resolve(root, "../.cache/work-tracker/frontend/vite-app"),
  server: { host: "127.0.0.1", proxy: { "/api": proxy(backend), "/ws": proxy(backend, true) } },
  build: {
    outDir: resolve(root, "../out/web"),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(root, "index.html"), sw: resolve(root, "src/sw.ts") },
      // The worker keeps a fixed address so the installed app finds its updates.
      output: { entryFileNames: (chunk) => chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js" },
    },
  },
})
