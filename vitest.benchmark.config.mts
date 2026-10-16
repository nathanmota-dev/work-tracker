import { defineConfig } from "vitest/config";

// Benchmarks run one file and one test at a time so measurements do not compete.
export default defineConfig({
  cacheDir: ".cache/work-tracker/benchmarks/backend/vite",
  test: {
    environment: "node",
    include: [],
    benchmark: { include: ["benchmarks/**/*.bench.ts"] },
    fileParallelism: false,
    maxWorkers: 1,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    fsModuleCache: true,
    fsModuleCachePath: ".cache/work-tracker/benchmarks/backend/transforms",
  },
});
