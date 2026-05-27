import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    css: false,
    // e2e/ is driven by Playwright, not vitest. Excluding here keeps
    // `npm test` from trying to import @playwright/test in jsdom.
    exclude: ["node_modules", "dist", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Coverage gate scope is intentionally narrow at PR #7: the
      // lib/ + store/ + component code that's unit-testable and
      // changes most often. Page-level files are covered by
      // Playwright E2E (see frontend/e2e/) and live outside this gate.
      // The threshold is a starting floor — raise it as the unit
      // suite grows.
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/store/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/**/*.stories.tsx",
        "src/api/schema.gen.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      thresholds: {
        lines: 15,
        statements: 15,
        functions: 15,
        branches: 50,
      },
    },
  },
});
