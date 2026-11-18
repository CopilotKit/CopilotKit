import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Read .env from the workspace root, where .env.example lives.
  envDir: "..",
  server: {
    port: 5173,
    proxy: {
      // CopilotKit's provider talks to the self-hosted CopilotRuntime here.
      "/api/copilotkit": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
