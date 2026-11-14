import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export default ({ mode }: { mode: string }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  return {
    plugins: [sveltekit()],
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
        allow: [packageRoot],
      },
    },
    optimizeDeps: {
      include: [
        "@copilotkit/core",
        "@copilotkit/shared",
        "@copilotkit/shared > partial-json",
      ],
      exclude: ["@copilotkit/svelte", "svelte/internal/client"],
    },
  };
};
