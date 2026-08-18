import { defineConfig } from "vitest/config";
import path from "node:path";

// Pure-logic unit tests only (no DOM, no rendering) — see
// docs/objective-foundation-feature.md for what's covered and why.
export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
