// Server-side helper that resolves and renders a partial MDX file by
// relative path under `src/content/snippets/`. Used by the stub
// components in `mdx-registry.tsx` so that a self-closing JSX
// reference on a live MDX page (e.g. `<Inspector />`,
// `<CopilotCloudConfigureCopilotKit />`) renders the body of its
// corresponding partial, rather than an empty `<div>`.
//
// The base mechanism for inlining `<Component />` references is
// implemented in `docs-render.tsx#inlineSnippets`, but that regex only
// fires for components in `SNIPPET_MAP` and only when invoked WITHOUT
// props (the regex matches `<Component />` and `<Component
// components={...} />` and nothing more elaborate). Stubs that take
// other props, or that aren't listed in `SNIPPET_MAP`, fall through to
// the in-tree component map — historically these were `<div>{children}</div>`
// shims, which silently rendered nothing when the consuming MDX passed
// no children.
//
// This loader is the runtime equivalent of those snippet-inline
// substitutions. Resolving partials at render time keeps the lookup
// in one place (the registry) and avoids modifying `docs-render.tsx`
// or the live MDX files under `src/content/docs/`.

import fs from "fs";
import path from "path";
import React from "react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { transformerMeta } from "./rehype-code-meta";
import { inlineSnippets, convertTablesInJSX } from "./docs-render";
import { resolveWithinDir } from "./safe-fs";

const SNIPPETS_DIR = path.join(process.cwd(), "src/content/snippets");

// Cache partial-file reads at module scope. Partials are part of the
// content tree and don't change at request time in production; in dev
// the cache is bypassed so authors see edits without a server restart.
const isDev = process.env.NODE_ENV === "development";
const partialCache = new Map<string, string | null>();

function readPartial(relativePath: string): string | null {
  const resolved = resolveWithinDir(SNIPPETS_DIR, relativePath);
  if (!resolved) return null;

  if (!isDev && partialCache.has(resolved)) {
    return partialCache.get(resolved)!;
  }

  if (!fs.existsSync(resolved)) {
    partialCache.set(resolved, null);
    return null;
  }

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    // Drop frontmatter (partials may carry their own, e.g. for
    // upstream docs.copilotkit.ai compatibility).
    const body = raw.replace(/^---[\s\S]*?---\r?\n?/, "");
    partialCache.set(resolved, body);
    return body;
  } catch (err) {
    // Log loudly but don't crash the page render — fall back to the
    // stub shape (nothing) and let the user-visible warning in
    // mdx-registry catch the regression.
    // eslint-disable-next-line no-console
    console.error(
      "[mdx-registry-loader] failed to read partial",
      resolved,
      err,
    );
    partialCache.set(resolved, null);
    return null;
  }
}

/**
 * Render the MDX partial named `relativePath` (relative to
 * `src/content/snippets/`) using the same component map and remark/rehype
 * plugins as the top-level docs page. The `components` prop is required
 * — callers pass the full `docsComponents` map so nested JSX inside the
 * partial (callouts, Tabs, etc.) renders correctly.
 *
 * Returns `null` when the partial doesn't exist; the caller is
 * responsible for emitting a dev-only diagnostic in that case.
 */
export async function PartialLoader({
  relativePath,
  components,
}: {
  relativePath: string;
  components: Record<string, React.ComponentType<Record<string, unknown>>>;
}): Promise<React.ReactElement | null> {
  const body = readPartial(relativePath);
  if (body === null) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("[mdx-registry-loader] partial not found:", relativePath);
      return (
        <div className="my-4 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-xs font-mono text-[var(--text-faint)]">
          [mdx-registry-loader] partial not found: {relativePath}
        </div>
      );
    }
    return null;
  }

  // Run the same snippet-inlining + table-promotion preprocessing as
  // the top-level docs page so a partial that itself references
  // another `<Snippet />` or contains tables inside JSX containers
  // renders identically wherever it's loaded.
  const inlined = inlineSnippets(body, "");
  const preprocessed = convertTablesInJSX(inlined);

  // MDXRemote is async in next-mdx-remote/rsc; awaiting it here
  // resolves to a renderable React element that the calling stub
  // returns directly.
  return (
    <MDXRemote
      source={preprocessed}
      components={
        components as React.ComponentProps<typeof MDXRemote>["components"]
      }
      options={{
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
      }}
    />
  );
}
