import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envDir, "");
  const runtimeUrl =
    env.COPILOTKIT_RUNTIME_URL ?? "http://localhost:4000/api/copilotkit";

  return {
    envDir,
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy: {
        "/api/copilotkit": {
          target: runtimeUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
    },
  };
});
