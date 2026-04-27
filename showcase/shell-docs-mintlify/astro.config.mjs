import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import { mintlify } from "@mintlify/astro";
import { fileURLToPath } from "node:url";
import {
  transformerNotationHighlight,
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationWordHighlight,
  transformerMetaHighlight,
} from "@shikijs/transformers";

import tailwindcss from "@tailwindcss/vite";
import remarkMintlifyCodeBlock from "./src/plugins/remark-mintlify-code-block.ts";

export default defineConfig({
  integrations: [mintlify({ docsDir: "./docs" }), react(), mdx()],
  markdown: {
    // Rewrite every fenced code block (with a language) into a
    // `<MintCodeBlock />` JSX element BEFORE Shiki sees it. Mintlify's
    // `<CodeBlock>` re-highlights client-side with its own bundled themes
    // and notation transformers, so we don't need server-side Shiki for
    // those blocks anymore. Inline single-backtick code (`<code>`) and any
    // fenced block without a language still flow through Astro's default
    // pipeline and render with the Shiki dual-theme settings below.
    remarkPlugins: [remarkMintlifyCodeBlock],
    shikiConfig: {
      // Dual-theme mode emits both `--shiki-light` and `--shiki-dark` CSS
      // variables on every token. global.css picks the active side based on
      // the `.dark` class on <html>, so code blocks flip in step with the
      // rest of the UI. `defaultColor: false` prevents Shiki from baking
      // either theme as a hard color — both are vars only.
      themes: {
        light: "catppuccin-latte",
        dark: "tokyo-night",
      },
      defaultColor: false,
      // Notation transformers stay enabled for any fenced block that escapes
      // the remark rewrite (currently: blocks with no language). They're a
      // no-op on `<MintCodeBlock />` JSX elements since those don't pass
      // through rehype-shiki at all.
      transformers: [
        transformerNotationHighlight(),
        transformerNotationDiff(),
        transformerNotationFocus(),
        transformerNotationErrorLevel(),
        transformerNotationWordHighlight(),
        transformerMetaHighlight(),
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "~components": fileURLToPath(
          new URL("./src/components", import.meta.url),
        ),
      },
    },
    ssr: {
      // @copilotkit/react-core's bundle imports its own CSS at module
      // evaluation time, which Node's loader can't process. Inline the
      // package through Vite so the CSS pipeline handles it.
      noExternal: ["@copilotkit/react-core"],
    },
  },
});
