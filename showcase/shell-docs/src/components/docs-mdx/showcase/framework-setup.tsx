// <FrameworkSetup concept="agent-setup" />: the framework's own setup steps,
// authored in showcase/integrations/<slug>/docs/setup/<concept>.mdx and
// bundled (with their <DemoCode> references expanded) into
// src/data/setup-content.json. A port of shell-docs' src/lib/setup-concept.tsx.
//
// The bundled MDX is compiled at runtime with the same Fumadocs preset as the
// live pages and rendered with the page's own component map, so fences and
// nested components look like the rest of the page. Compiles are cached per
// (framework, concept).

import { createCompiler } from "@fumadocs/mdx-remote";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import type { DocsMdxContext } from "../context";
import { getSetupContent } from "../data";
import type { DocsScope } from "../scope";

/** Frameworks that reuse another's setup concepts. */
const SETUP_CONTENT_FALLBACKS: Record<string, string[]> = {
  "langgraph-fastapi": ["langgraph-python"],
};

function resolveSetupSource(framework: string, concept: string) {
  const { concepts } = getSetupContent();
  for (const candidate of [
    framework,
    ...(SETUP_CONTENT_FALLBACKS[framework] ?? []),
  ]) {
    const source = concepts[`${candidate}::${concept}`]?.source;
    if (source !== undefined) return source;
  }
  return null;
}

// The live pages' MDX options (src/lib/live-source.ts): code in a language
// Shiki doesn't ship reads as plain text, and blocks name their language.
const compiler = createCompiler({
  rehypeCodeOptions: {
    ...rehypeCodeDefaultOptions,
    fallbackLanguage: "plaintext",
    addLanguageClass: true,
  },
});

type Compiled = Awaited<ReturnType<typeof compiler.compile>>;
const compiled = new Map<string, Promise<Compiled>>();

function compileConcept(key: string, source: string): Promise<Compiled> {
  let pending = compiled.get(key);
  if (!pending) {
    pending = compiler.compile({ source });
    // A failed compile isn't cached, so a fix to the bundle is picked up.
    pending.catch(() => compiled.delete(key));
    compiled.set(key, pending);
  }
  return pending;
}

export async function FrameworkSetup({
  scope,
  ctx,
  concept,
  currentFramework,
}: {
  scope: DocsScope;
  ctx: DocsMdxContext;
  concept: string;
  /** Used when the URL names no framework. */
  currentFramework?: string;
  /** Deprecated in shell-docs and ignored: concepts own their structure. */
  heading?: string | null;
  headingId?: string;
}) {
  const framework = scope.framework ?? currentFramework;
  if (!framework) return null;

  // A concept nobody bundled for this framework is a deliberate "no setup
  // needed here".
  const source = resolveSetupSource(framework, concept);
  if (source === null) return null;

  let result: Compiled;
  try {
    result = await compileConcept(`${framework}::${concept}`, source);
  } catch (err) {
    // A concept that IS bundled and doesn't compile is a defect: fail loudly
    // rather than render as if the framework needed no setup (OSS-1036).
    throw new Error(
      `[framework-setup] bundled concept "${concept}" for ${framework} failed to compile`,
      { cause: err },
    );
  }
  const Body = result.body;
  return <Body components={ctx.components()} />;
}
