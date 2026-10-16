import { defineConfig } from "vitest/config";

// Dedicated vitest config (vitest prefers this over `vite.config.ts`, which would otherwise pull
// in the `@crxjs` plugin + manifest and choke in a plain Node test environment).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/chrome-mock.ts"],
  },
});
