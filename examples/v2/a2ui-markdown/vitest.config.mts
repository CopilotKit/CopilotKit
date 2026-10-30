import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["kumo/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // Transform the CopilotKit and Kumo packages instead of handing them
        // to Node's ESM loader, which cannot import their CSS.
        inline: [/@copilotkit\//, /@cloudflare\/kumo/],
      },
    },
  },
});
