import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ["@copilotkitnext/vue/styles.css", "~/assets/css/main.css"],
  alias: {
    // Nuxt's SSR style extraction does not resolve the workspace package CSS export reliably.
    "@copilotkitnext/vue/styles.css": resolve(
      currentDir,
      "../../../../packages/v2/vue/dist/styles.css",
    ),
  },
  vite: {
    ssr: {
      noExternal: ["@copilotkitnext/vue", "@ag-ui/client", "fast-json-patch"],
    },
  },
  postcss: {
    plugins: {
      "@tailwindcss/postcss": {},
    },
  },
  typescript: {
    strict: true,
  },
});
