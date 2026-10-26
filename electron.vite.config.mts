import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import { pdfAssets } from "./web/vite.pdf-assets"

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
