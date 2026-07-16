// <FrameworkSetup concept="..."> renders package-owned setup snippets.
//
// The snippets live under showcase/integrations/<slug>/docs/setup/*.mdx, but
// production shell-docs does not ship integration package source files. The
// build step expands those files into src/data/setup-content.json, including
// any <DemoCode /> references, and this server component renders the bundled
// source.

import React from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { docsComponents } from "@/lib/mdx-registry";
import { transformerMeta } from "@/lib/rehype-code-meta";
import { createTrustedMdxRemoteOptions } from "@/lib/trusted-mdx-options";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { resolveBundledSetupConcept } from "@/lib/setup-content";
import type { SetupContentBundle } from "@/lib/setup-content";
import setupContentData from "@/data/setup-content.json";

const setupContent = setupContentData as SetupContentBundle;

export interface FrameworkSetupProps {
  concept: string;
  /**
   * @deprecated Earlier designs wrapped the body in a disclosure / heading.
   * The current design renders concept MDX inline; concept authors own their
   * own structure. Kept for back-compat with older authored calls; ignored.
   */
  heading?: string | null;
  /** @deprecated Same as `heading`; ignored. */
  headingId?: string;
  /** Injected by the page render site via the components-map override. */
  currentFramework?: string;
}

export async function FrameworkSetup({
  concept,
  currentFramework,
}: FrameworkSetupProps): Promise<React.ReactElement | null> {
  if (!currentFramework) return null;

  const source = resolveBundledSetupConcept(
    currentFramework,
    concept,
    setupContent,
  );
  if (source === null) return null;

  try {
    return await MDXRemote({
      source,
      components: {
        ...docsComponents,
        pre: MdxCodeBlock,
      },
      options: createTrustedMdxRemoteOptions({
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
      }),
    });
  } catch (err) {
    console.error(
      `[framework-setup] failed to compile bundled concept "${concept}" for ${currentFramework}`,
      err,
    );
    return null;
  }
}
