import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts", "apps/client/test/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
  },
});
