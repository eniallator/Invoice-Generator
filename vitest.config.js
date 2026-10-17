import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    isolate: true,
    passWithNoTests: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Test support code (the process entries are in ./scripts, so are not
      // included in the first place)
      exclude: ["src/test-helpers.ts", "src/**/*.test.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
