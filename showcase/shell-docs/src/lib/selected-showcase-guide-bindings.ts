import { inlineSnippets } from "./docs-render";
import { resolveFrameworkContent } from "./framework-content-resolution";
import { getIntegration, getRegistry } from "./registry";

/** The selected-five React audit scope. This is a scope, not a docs mapping. */
export const SELECTED_REACT_INTEGRATIONS = [
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
  "strands",
  "built-in-agent",
] as const;

export interface SelectedShowcaseGuideBinding {
  framework: (typeof SELECTED_REACT_INTEGRATIONS)[number];
  cell: string;
  route: string | null;
  command: string | null;
  contentSlugPath: string;
  rawSource: string;
  source: string;
}

function docsPathForFeature(
  framework: string,
  featureId: string,
): string | null {
  const integration = getIntegration(framework);
  const integrationPath =
    integration?.docs_links?.features?.[featureId]?.shell_docs_path;
  const registryPath = getRegistry().feature_registry.features.find(
    (feature) => feature.id === featureId,
  )?.shell_docs_path;
  const path = integrationPath ?? registryPath;
  return typeof path === "string" && path.startsWith("/")
    ? path.slice(1)
    : null;
}

/**
 * Derive actual selected feature-guide bindings from registry demos and their
 * canonical docs-links. There is intentionally no hand-maintained list of
 * feature routes or cells here.
 */
export function selectedShowcaseGuideBindings(): SelectedShowcaseGuideBinding[] {
  const bindings: SelectedShowcaseGuideBinding[] = [];

  for (const framework of SELECTED_REACT_INTEGRATIONS) {
    const integration = getIntegration(framework);
    if (!integration) continue;
    const unavailable = new Set(integration.not_supported_features ?? []);

    for (const demo of integration.demos) {
      if (unavailable.has(demo.id)) continue;
      const docsPath = docsPathForFeature(framework, demo.id);
      if (!docsPath) continue;
      const resolved = resolveFrameworkContent(framework, docsPath);
      if (!resolved) continue;

      bindings.push({
        framework,
        cell: demo.id,
        route: demo.route ?? null,
        command: demo.command ?? null,
        contentSlugPath: resolved.contentSlugPath,
        rawSource: resolved.doc.source,
        source: inlineSnippets(resolved.doc.source, resolved.contentSlugPath),
      });
    }
  }

  return bindings;
}

export type ShowcaseSourceCarrier =
  | "inline-demo"
  | "snippet"
  | "framework-setup"
  | "shared-content";

/**
 * Identify the source carrier after shared MDX imports are expanded. The
 * caller must still render it: a carrier tag alone is not proof that a
 * framework has the requested region or setup bundle.
 */
export function showcaseSourceCarrier(
  binding: SelectedShowcaseGuideBinding,
): ShowcaseSourceCarrier | null {
  if (/<InlineDemo\b/.test(binding.source)) return "inline-demo";
  if (/<Snippet\b/.test(binding.source)) return "snippet";
  if (/<FrameworkSetup\b/.test(binding.source)) return "framework-setup";

  // SharedContent is an imported MDX source carrier. It is used by the slots
  // wrapper with a runtime `components` prop, so it intentionally remains a
  // component boundary after inlining rather than looking like a bare Snippet.
  return /import\s+SharedContent\s+from\s+["']@\/snippets\//.test(
    binding.rawSource,
  )
    ? "shared-content"
    : null;
}
