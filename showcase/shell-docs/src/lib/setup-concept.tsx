// <FrameworkSetup concept="..."> — package-owned, framework-aware
// setup snippets.
//
// Resolution flow:
//   1. Read the URL framework slug from the `currentFramework` prop.
//      Authored MDX never passes this — DocsPageView's components-map
//      override injects it via the per-render closure (same pattern as
//      <MdxFrameworkOverview>). When unset, the slot renders null.
//   2. Read `showcase/integrations/<currentFramework>/docs/setup/<concept>.mdx`
//      through `resolveSetupConcept` (path-traversal-safe, cached).
//
//      We use the URL slug directly here — NOT `getDocsFolder(slug)`.
//      Shared-folder semantics (langgraph-python/typescript/fastapi
//      sharing `langgraph/`, ms-agent-{dotnet,python} sharing
//      `microsoft-agent-framework/`) apply to docs CONTENT, not to
//      integration PACKAGES. Each integration package has its own
//      source tree (LGP has `src/agents/*.py`, LGTS has
//      `src/agent/*.ts`), so concept files — which embed `<DemoCode>`
//      references into their own package source — must resolve per
//      package. A LangGraph-Python copilot-middleware concept lives
//      ONLY at `langgraph-python/docs/setup/...`; LGTS / Fastapi
//      ship their own as needed.
//   3. Apply the <DemoCode> source-rewrite pass — replace each static
//      `<DemoCode file="..." region="..." />` reference with a fenced
//      markdown code block sourced from the package's filesystem. The
//      rewrite closes over the package root, so DemoCode never reaches
//      into another framework's source.
//   4. Compile the rewritten source via MDXRemote with the standard
//      docsComponents map plus a defensive `DemoCode` component shim
//      (handles any reference the regex couldn't statically expand).
//
// Missing concept file → returns null. Empty concept file → returns
// null. Both are intentional: "this framework needs no setup at this
// page" is expressed by simply not authoring a file.

import React from "react";
import fs from "fs";
import path from "path";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { docsComponents } from "@/lib/mdx-registry";
import { transformerMeta } from "@/lib/rehype-code-meta";
import { resolveSetupConcept } from "@/lib/docs-render";
import { extractRegion, inferLanguage } from "@/lib/demo-code";
import { rewriteDemoCode } from "@/lib/rewrite-demo-code";
import { resolveWithinDir } from "@/lib/safe-fs";

/**
 * Defensive `<DemoCode>` component shim.
 *
 * The source-rewrite pass below expands `<DemoCode file="..." region="..." />`
 * references into fenced markdown blocks BEFORE MDXRemote sees the
 * source, so this component normally never executes. It exists as a
 * fallback for two cases:
 *
 *   1. A `<DemoCode>` reference with an expression-valued prop (e.g.
 *      `file={someVar}`) that the static regex can't pre-expand.
 *   2. Future call sites that bypass the orchestrator and use
 *      `<DemoCode>` directly (not recommended, but supported).
 *
 * In both cases this server component reads the file at render time,
 * extracts the region, and emits a plain `<pre>` — no Shiki highlighting,
 * since we're not flowing through rehype-code at this point. Authors who
 * want highlighting use the orchestrator's source-rewrite path (the
 * default — happens automatically when the reference is static).
 *
 * `createDemoCodeComponent` is a closure factory: the orchestrator
 * supplies the integration package root so DemoCode resolves `file`
 * relative to its concept file's package, never relative to the URL
 * framework slug.
 */
export interface DemoCodeProps {
  file: string;
  region: string;
  language?: string;
  title?: string;
}

export function createDemoCodeComponent(
  packageRoot: string,
): React.FC<DemoCodeProps> {
  const DemoCode: React.FC<DemoCodeProps> = ({
    file,
    region,
    language,
    title,
  }) => {
    const resolved = resolveWithinDir(packageRoot, file);
    if (!resolved || !fs.existsSync(resolved)) {
      console.warn(
        "[demo-code] file not found",
        file,
        "in package root",
        packageRoot,
      );
      return null;
    }
    let source: string;
    try {
      source = fs.readFileSync(resolved, "utf-8");
    } catch (err) {
      console.warn("[demo-code] failed to read", resolved, err);
      return null;
    }
    const ext = file.includes(".")
      ? file.slice(file.lastIndexOf(".") + 1).toLowerCase()
      : "";
    let body: string | null;
    try {
      body = extractRegion(source, region, ext);
    } catch (err) {
      console.warn(
        "[demo-code] extraction failed",
        file,
        region,
        (err as Error).message,
      );
      return null;
    }
    if (body === null) {
      console.warn("[demo-code] region not found", region, "in", file);
      return null;
    }
    const lang = language ?? inferLanguage(file);
    return (
      <pre data-language={lang} data-title={title ?? path.basename(file)}>
        <code className={`language-${lang}`}>{body}</code>
      </pre>
    );
  };
  DemoCode.displayName = `DemoCode(${packageRoot})`;
  return DemoCode;
}

// Absolute path to `showcase/integrations/`. Computed once at module
// load time; Next.js runs server components from `process.cwd()` of
// the shell-docs package root.
export const INTEGRATIONS_ROOT = path.resolve(
  process.cwd(),
  "..",
  "integrations",
);

export interface FrameworkSetupProps {
  concept: string;
  /** Injected by the page render site via the components-map override. */
  currentFramework?: string;
}

export async function FrameworkSetup({
  concept,
  currentFramework,
}: FrameworkSetupProps): Promise<React.ReactElement | null> {
  if (!currentFramework) return null;
  // Use the URL slug directly — concept files are per-package, never
  // shared across slugs. See the resolution-flow comment at the top of
  // this file for why getDocsFolder is the wrong call here.
  const source = resolveSetupConcept(
    INTEGRATIONS_ROOT,
    currentFramework,
    concept,
  );
  if (source === null) return null;

  const packageRoot = path.join(INTEGRATIONS_ROOT, currentFramework);
  // Strip leading frontmatter (if any) so it never renders as a literal
  // YAML dump.
  const sourceNoFm = source.replace(/^---[\s\S]*?---\r?\n?/, "");
  const rewritten = rewriteDemoCode(sourceNoFm, packageRoot);
  const DemoCodeShim = createDemoCodeComponent(packageRoot);

  try {
    return (
      <MDXRemote
        source={rewritten}
        components={{
          ...docsComponents,
          DemoCode: DemoCodeShim,
        }}
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
  } catch (err) {
    console.error(
      `[framework-setup] failed to compile concept "${concept}" for ${currentFramework}`,
      err,
    );
    return null;
  }
}
