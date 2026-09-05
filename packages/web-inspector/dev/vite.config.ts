import { fileURLToPath } from "node:url";

import type { Plugin, UserConfig } from "vite";

import { createThreadsStateLabPlugin } from "./threads-state-lab-server.js";
import { createLearningStateLabPlugin } from "./learning-state-lab-server.js";

/**
 * Mirrors the package bundler's CSS-as-string behavior for the standalone
 * harness. The Inspector injects generated.css into Shadow DOM via unsafeCSS,
 * so the dev server rewrites that package-local import to Vite's raw string
 * loader without changing production source.
 */
const cssRawImportPlugin = {
  name: "web-inspector-css-raw-import",
  enforce: "pre",
  transform(code: string, id: string): string | null {
    if (!id.endsWith("/src/index.ts")) return null;
    const cssImport = 'import tailwindStyles from "./styles/generated.css";';
    if (!code.includes(cssImport)) {
      throw new Error(
        "web-inspector dev CSS transform expected src/index.ts to include the generated.css import",
      );
    }
    return code.replace(
      cssImport,
      'import tailwindStyles from "./styles/generated.css?raw";',
    );
  },
} as const satisfies Plugin;

const config = {
  plugins: [
    cssRawImportPlugin,
    createThreadsStateLabPlugin(),
    createLearningStateLabPlugin(),
  ],
  resolve: {
    alias: {
      "@copilotkit/web-inspector": fileURLToPath(
        new URL("../src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
  },
} satisfies UserConfig;

export default config;
