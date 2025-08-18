import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from 'fumadocs-mdx/config';
import { z } from 'zod';

import {
  fileGenerator,
  remarkDocGen,
  remarkInstall,
  typescriptGenerator,
} from "fumadocs-docgen";
import { rehypeCode } from "fumadocs-core/mdx-plugins";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
  // ...
} from "@shikijs/transformers";
import { remarkMermaid } from '@theguild/remark-mermaid'

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
  mdxOptions: {
    rehypePlugins: [
      [
        rehypeCode,
        {
          transformers: [
            transformerNotationDiff(),
            transformerNotationHighlight(),
            transformerNotationWordHighlight(),
          ],
        },
      ],
    ],
    remarkPlugins: [
      remarkMermaid,
      [remarkInstall, { persist: { id: "package-manager" } }],
      [remarkDocGen, { generators: [typescriptGenerator(), fileGenerator()] }],
    ],
  },
});
