import { sveltekit } from "@sveltejs/kit/vite";
import path from "path";
import { loadEnv } from "vite";

const workspaceRoot = path.resolve("../../../..");

export default ({ mode }: { mode: string }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  return {
    plugins: [sveltekit()],
    resolve: {
      alias: [
        {
          find: "@segment/analytics-node",
          replacement: path.resolve("src/lib/segment-stub.js"),
        },
        {
          // Keep the SDK source hot-reloadable without intercepting public
          // subpath exports such as @copilotkit/svelte/styles.css.
          find: /^@copilotkit\/svelte$/,
          replacement: path.resolve(
            workspaceRoot,
            "packages/svelte/src/index.ts",
          ),
        },
      ],
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
