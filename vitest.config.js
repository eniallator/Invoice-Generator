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
      // The process entries (they exit the process, shell out to latexmk or touch
      // Google Drive) and test support code
      exclude: [
        "src/generate.ts",
        "src/fetch-db.ts",
        "src/draft-invoices.ts",
        "src/email-invoices.ts",
        "src/test-helpers.ts",
        "src/**/*.test.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
