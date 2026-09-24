import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": path.join(root, "test/server-only-stub.ts"),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
