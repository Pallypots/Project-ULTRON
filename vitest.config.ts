import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "services/*/test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 20000,
    // Real-model tests report their results as GitHub notices through console output; always show it.
    silent: false,
  },
});
