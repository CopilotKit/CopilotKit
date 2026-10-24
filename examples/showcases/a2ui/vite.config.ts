import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // The runtime route reads CPK_INTELLIGENCE_API_KEY and AGENT_URL from
  // process.env on the server; Vite only loads .env into import.meta.env.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ""))) {
    process.env[key] ??= value;
  }
  return {
    resolve: { tsconfigPaths: true },
    plugins: [tanstackStart(), viteReact()],
    // react-core imports its own stylesheet from JavaScript. Node cannot load
    // a .css import during server rendering, so Vite bundles the package.
    ssr: { noExternal: ["@copilotkit/react-core"] },
  };
});
