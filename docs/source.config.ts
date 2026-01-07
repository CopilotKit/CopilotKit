import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from 'fumadocs-mdx/config';
import lastModified from 'fumadocs-mdx/plugins/last-modified';
import { z } from 'zod';

import {
  fileGenerator,
  remarkDocGen,
  remarkInstall,
} from "fumadocs-docgen";
import { remarkAutoTypeTable, createGenerator } from "fumadocs-typescript";
import { rehypeCode } from "fumadocs-core/mdx-plugins";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { remarkMermaid } from '@theguild/remark-mermaid';

const typeGenerator = createGenerator();

// Extend the frontmatter schema to include hideHeader and hideTOC fields
const extendedFrontmatterSchema = frontmatterSchema.extend({
  hideHeader: z.boolean().optional(),
  hideTOC: z.boolean().optional(),
});

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.vercel.app/docs/mdx/collections#define-docs
export const docs = defineDocs({
  docs: {
    schema: extendedFrontmatterSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  plugins: [lastModified()],
  mdxOptions: {
    rehypePlugins: [
      [
        rehypeCode,
        {
          transformers: [
            transformerNotationDiff({ matchAlgorithm: "v3" }),
            transformerNotationHighlight({ matchAlgorithm: "v3" }),
            transformerNotationWordHighlight({ matchAlgorithm: "v3" }),
          ],
        },
      ],
    ],
    remarkPlugins: [
      remarkMermaid,
      [remarkInstall, { persist: { id: "package-manager" } }],
      [remarkDocGen, { generators: [fileGenerator()] }],
      [remarkAutoTypeTable, { generator: typeGenerator }],
    ],
    remarkNpmOptions: {
      persist: { id: "package-manager" },
    },
  },
});
