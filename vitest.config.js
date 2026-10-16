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
      // The process entry (exits the process and shells out to latexmk) and test support code
      exclude: ["src/generate.ts", "src/test-helpers.ts", "src/**/*.test.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
