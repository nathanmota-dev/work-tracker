import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import layers from "../scripts/ci/layers.json" with { type: "json" }

const { coverage } = layers.frontend

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  cacheDir: fileURLToPath(new URL("../.cache/work-tracker/frontend/vite", import.meta.url)),
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    fsModuleCache: true,
    fsModuleCachePath: fileURLToPath(new URL("../.cache/work-tracker/frontend/transforms", import.meta.url)),
    coverage: {
      provider: "v8",
      reportsDirectory: fileURLToPath(new URL(`../${coverage.reportsDirectory}`, import.meta.url)),
      reporter: ["text", "html", "json", "json-summary"],
      include: coverage.include,
      exclude: coverage.exclude,
    },
  },
})
