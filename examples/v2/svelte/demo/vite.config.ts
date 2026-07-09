import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";
import { loadEnv } from "vite";

const workspaceRoot = path.resolve("../../../..");

export default ({ mode }: { mode: string }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  return {
    plugins: [sveltekit()],
    resolve: {
      alias: {
        "@segment/analytics-node": path.resolve("src/lib/segment-stub.js"),
        "@copilotkit/svelte": path.resolve(
          workspaceRoot,
          "packages/svelte/src/index.ts",
        ),
      },
    },
    ssr: {
      noExternal: [
        "@copilotkit/svelte",
        "@copilotkit/core",
        "@copilotkit/shared",
        "@copilotkit/web-components",
        "@copilotkit/web-inspector",
      ],
    },
    server: {
      fs: {
        allow: [workspaceRoot],
      },
    },
    optimizeDeps: {
      exclude: ["@copilotkit/svelte", "svelte/internal/client"],
    },
  };
};
