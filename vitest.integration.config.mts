import { defineConfig } from "vitest/config";
export default defineConfig({
  cacheDir: ".cache/work-tracker/integration/vite",
  test: {
    fsModuleCache: true,
    fsModuleCachePath: ".cache/work-tracker/integration/transforms",
    environment: "node",
    include: ["src/test/integration/**/*.test.ts"],
    testTimeout: 20000,
  },
});
