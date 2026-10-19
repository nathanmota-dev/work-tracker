import { defineConfig } from "vitest/config";
import layers from "./scripts/ci/layers.json" with { type: "json" };

const { coverage } = layers.backend;
export default defineConfig({
  cacheDir: ".cache/work-tracker/backend/vite",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "desktop/src/**/*.test.ts"],
    exclude: ["src/test/integration/**"],
    setupFiles: ["src/test/unit-setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    fsModuleCache: true,
    fsModuleCachePath: ".cache/work-tracker/backend/transforms",
    coverage: {
      provider: "v8",
      reportsDirectory: coverage.reportsDirectory,
      reporter: ["text", "html", "json", "json-summary"],
      include: coverage.include,
      exclude: coverage.exclude,
    },
  },
});
