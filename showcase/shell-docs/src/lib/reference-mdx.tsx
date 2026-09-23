// MDX rendering inputs for `/reference/...` pages.
//
// Reference pages start from the same shared component registry the docs
// pages use (`docsComponents`), so a snippet inlined from
// `@/snippets/...` renders the same components (Tabs, Steps, Snippet,
// FrameworkSetup, ...) on either surface. The reference-specific entries
// below keep their existing chrome on top of that registry.

import type React from "react";
import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import { LinkIcon } from "lucide-react";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { PropertyReference } from "@/components/property-reference";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import { inlineSnippets } from "./docs-render";
import { docsComponents } from "./mdx-registry";
import { transformerMeta } from "./rehype-code-meta";

export const referenceMdxComponents = {
  ...docsComponents,
  PropertyReference,
  // Render fenced code blocks through the same Shiki + Fumadocs CodeBlock
  // chrome the main docs use (syntax highlighting + copy button), paired with
  // the rehypeCode plugin in `referenceMdxOptions`.
  pre: MdxCodeBlock,
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  OpsPlatformCTA,
  LinkIcon,
  Frame: ({ children }: { children: React.ReactNode }) => (
    <div className="shell-docs-radius-surface my-6 border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-control)]">
      {children}
    </div>
  ),
};

export const referenceMdxOptions: MDXRemoteProps["options"] = {
  mdxOptions: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      [
        rehypeCode,
        {
          fallbackLanguage: "plaintext",
          transformers: [
            ...(rehypeCodeDefaultOptions.transformers ?? []),
            transformerMeta(),
          ],
        },
      ],
    ],
  },
};

/**
 * The slug path a reference page hands to snippet inlining, in the same
 * content-path form docs pages pass (`reference/<contentSlug>`).
 */
export function referenceSnippetSlug(contentSlug: string): string {
  return `reference/${contentSlug}`;
}

/**
 * Inline `@/snippets/...` imports the way docs pages do. This also strips the
 * top-of-file import block, which next-mdx-remote cannot evaluate.
 */
export function prepareReferenceSource(
  content: string,
  contentSlug: string,
): string {
  return inlineSnippets(content, referenceSnippetSlug(contentSlug));
}
