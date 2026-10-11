import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      // "server-only" throws outside the react-server condition; Next enforces it at build time.
      "server-only": path.resolve(__dirname, "test-shims/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
