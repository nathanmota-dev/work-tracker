import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/test/integration/**"],
    setupFiles: ["src/test/unit-setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/backend/unit",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/**/*.d.ts",
        "src/version.gen.ts",
        "src/db/schema.ts",
        "src/match/synonyms.ts",
        "src/adapters/types.ts",
        "src/mcp/withdraw.ts",
        "src/cli/index.ts",
        "src/cli/setup.ts",
        "src/cli/detect-portal.ts",
      ],
    },
  },
});
