import { defineConfig } from "vite";

/**
 * Mirrors the package bundler's CSS-as-string behavior for the standalone
 * harness. The inspector injects generated.css into Shadow DOM via unsafeCSS,
 * so the dev server rewrites that package-local import to Vite's raw string
 * loader without changing production source.
 */
export default defineConfig({
  plugins: [
    {
      name: "web-inspector-css-raw-import",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith("/src/index.ts")) return null;
        return code.replace(
          'import tailwindStyles from "./styles/generated.css";',
          'import tailwindStyles from "./styles/generated.css?raw";',
        );
      },
    },
  ],
});
