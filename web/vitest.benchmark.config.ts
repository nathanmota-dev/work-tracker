import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Benchmarks run one file and one test at a time so measurements do not compete.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  cacheDir: fileURLToPath(new URL("../.cache/work-tracker/benchmarks/frontend/vite", import.meta.url)),
  test: {
    environment: "node",
    include: [],
    benchmark: { include: ["benchmarks/**/*.bench.ts"] },
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    fsModuleCache: true,
    fsModuleCachePath: fileURLToPath(new URL("../.cache/work-tracker/benchmarks/frontend/transforms", import.meta.url)),
  },
})
