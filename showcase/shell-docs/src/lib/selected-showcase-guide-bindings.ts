/**
 * Selected-five Showcase guide guard.
 *
 * Proves that every applicable React feature guide for the selected
 * integrations renders, in both the HTML page and the raw Markdown endpoint,
 * the Showcase implementation of THAT framework and cell. Missing coverage is
 * a failure, never a silent skip.
 *
 * Three layers, so each failure mode can be exercised with synthetic inputs:
 *
 *   1. `collectGuideBindings()` maps each registry demo to its docs path and
 *      the MDX the framework-scoped page renders. An unresolved binding fails
 *      unless the manifest declares the cell unsupported or
 *      `SELECTED_GUIDE_EXCLUSIONS` names it with a reviewed reason.
 *   2. `htmlGuideCarriers()` and `renderGuideMarkdown()` are the real
 *      renderers. HTML carriers go through the same `<Snippet>`,
 *      `<InlineDemo>`, and setup-bundle lookups that `DocsPageView` uses;
 *      Markdown goes through `renderPageToLlmText()` exactly as `llms-mdx`
 *      calls it.
 *   3. `auditRenderedGuide()` and `auditCommandGuide()` are pure checks over
 *      those two renders.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HighlightedDynamicCodeBlock } from "@/components/highlighted-dynamic-codeblock";
import {
  NoShowcaseDemoBox,
  Snippet,
  UnsupportedBox,
} from "@/components/snippet";
import demoContent from "@/data/demo-content.json";
import setupContentData from "@/data/setup-content.json";
import { docCandidateOrder, inlineSnippets, loadDoc } from "./docs-render";
import { renderPageToLlmText } from "./llm-text";
import { docsComponents } from "./mdx-registry";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  getRegistry,
} from "./registry";
import type { Integration } from "./registry";
import { resolveBundledSetupConcept } from "./setup-content";
import type { SetupContentBundle } from "./setup-content";
import { NO_SHOWCASE_DEMO_MARKDOWN } from "./showcase-demo-availability";
import { filterFrameworkScopedBlocks, filterFrontendScopedBlocks } from "./toc";

/** The selected-five React audit scope. This is a scope, not a docs mapping. */
export const SELECTED_REACT_INTEGRATIONS = [
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
  "strands",
  "built-in-agent",
] as const;

const BEAUTIFUL_CHAT_REASON =
  "Flagship multi-feature starter demo (A2UI, open generative UI, canvas, charts, theming, and MCP Apps where configured); each constituent feature has its own guide, and no single feature guide should embed it.";

/**
 * Reviewed bindings that are NOT required to render their own cell's
 * Showcase source, keyed `framework:cell`. Every entry needs a reason. The
 * guard test prints this list, and an entry that no longer matches a
 * selected demo fails. When a framework genuinely lacks a feature, declare it
 * in the manifest's `not_supported_features` instead; this list is only for
 * docs-routing decisions.
 */
export const SELECTED_GUIDE_EXCLUSIONS: Readonly<Record<string, string>> = {
  "built-in-agent:agentic-chat":
    "Registry alias: the Built-in Agent agentic-chat docs link targets the framework quickstart, which documents setup rather than this cell's source.",
  "langgraph-python:beautiful-chat": BEAUTIFUL_CHAT_REASON,
  "langgraph-typescript:beautiful-chat": BEAUTIFUL_CHAT_REASON,
  "google-adk:beautiful-chat": BEAUTIFUL_CHAT_REASON,
  "built-in-agent:beautiful-chat": BEAUTIFUL_CHAT_REASON,
  // The Strands beautiful-chat runtime configures no mcpApps.
  "strands:beautiful-chat":
    "Flagship multi-feature starter demo (A2UI, open generative UI, canvas, charts, and theming); each constituent feature has its own guide, and no single feature guide should embed it.",
  "strands:hitl-in-chat-booking":
    "Deprecated alias of hitl-in-chat: same /demos/hitl-in-chat route and highlight files, already rendered by the Strands interactive guide.",
  "strands:hitl":
    "Deprecated original HITL cell routed to the shared root agent, which has no pausing tool; its useHumanInTheLoop pattern is documented by hitl-in-chat. (Strands native interrupts are documented via the /interrupt agent.)",
};

export interface SelectedShowcaseGuideBinding {
  framework: string;
  cell: string;
  /** Runnable Showcase route, or null for a command-only cell (cli-start). */
  route: string | null;
  command: string | null;
  /** Docs URL tail the binding targets, e.g. `frontend-tools`. */
  slugPath: string;
  /** MDX the framework-scoped page renders for `slugPath`. */
  contentSlugPath: string;
}

export interface GuideBindingSources {
  frameworks: readonly string[];
  integration(
    framework: string,
  ): Pick<Integration, "demos" | "not_supported_features"> | undefined;
  /** Canonical docs path for a feature (`/frontend-tools`), if declared. */
  docsPath(framework: string, featureId: string): string | null | undefined;
  /** The MDX a framework-scoped page renders for a docs URL tail. */
  resolveGuide(
    framework: string,
    slugPath: string,
  ): { contentSlugPath: string } | null;
  exclusions: Readonly<Record<string, string>>;
}

export interface GuideBindingCollection {
  bindings: SelectedShowcaseGuideBinding[];
  /** `framework:cell` pairs the manifests declare unsupported. */
  declaredUnsupported: string[];
  excluded: Array<{ key: string; reason: string }>;
  failures: string[];
}

/** Map every selected demo to its effective guide, or record why it can't. */
export function collectGuideBindings(
  sources: GuideBindingSources,
): GuideBindingCollection {
  const collection: GuideBindingCollection = {
    bindings: [],
    declaredUnsupported: [],
    excluded: [],
    failures: [],
  };
  const matchedExclusions = new Set<string>();

  for (const framework of sources.frameworks) {
    const integration = sources.integration(framework);
    if (!integration) {
      collection.failures.push(`${framework}: no registry integration`);
      continue;
    }
    const unsupported = new Set(integration.not_supported_features ?? []);

    for (const demo of integration.demos) {
      const key = `${framework}:${demo.id}`;
      const exclusion = sources.exclusions[key];
      if (exclusion !== undefined) matchedExclusions.add(key);

      if (unsupported.has(demo.id)) {
        collection.declaredUnsupported.push(key);
        if (exclusion !== undefined) {
          collection.failures.push(
            `${key}: excluded, but the manifest already declares it unsupported`,
          );
        }
        continue;
      }
      if (exclusion !== undefined) {
        if (exclusion.trim() === "") {
          collection.failures.push(`${key}: exclusion has no reason`);
        }
        collection.excluded.push({ key, reason: exclusion });
        continue;
      }

      const docsPath = sources.docsPath(framework, demo.id);
      if (typeof docsPath !== "string" || docsPath === "") {
        collection.failures.push(
          `${key}: no docs path. Declare the cell in not_supported_features or add a reviewed exclusion.`,
        );
        continue;
      }
      if (!docsPath.startsWith("/")) {
        collection.failures.push(
          `${key}: docs path "${docsPath}" is not root-relative`,
        );
        continue;
      }
      const slugPath = docsPath.slice(1);
      const resolved = sources.resolveGuide(framework, slugPath);
      if (!resolved) {
        collection.failures.push(
          `${key}: docs path ${docsPath} resolves to no guide`,
        );
        continue;
      }

      collection.bindings.push({
        framework,
        cell: demo.id,
        route: demo.route ?? null,
        command: demo.command ?? null,
        slugPath,
        contentSlugPath: resolved.contentSlugPath,
      });
    }
  }

  for (const key of Object.keys(sources.exclusions)) {
    if (!matchedExclusions.has(key)) {
      collection.failures.push(
        `${key}: stale exclusion, no selected demo has this id`,
      );
    }
  }
  return collection;
}

/**
 * The MDX a framework-scoped URL renders. Same lookup as the page route's
 * body resolver and `llms-mdx` (both iterate `docCandidateOrder`).
 */
export function resolveFrameworkGuide(
  framework: string,
  slugPath: string,
): { contentSlugPath: string } | null {
  const docsMode = getDocsMode(framework);
  if (docsMode === "hidden") return null;
  for (const candidate of docCandidateOrder(
    docsMode,
    getDocsFolder(framework),
    slugPath,
  )) {
    if (loadDoc(candidate)) return { contentSlugPath: candidate };
  }
  return null;
}

/** Real registry inputs for the selected-five guard. */
export function selectedGuideSources(): GuideBindingSources {
  const features = getRegistry().feature_registry.features;
  return {
    frameworks: SELECTED_REACT_INTEGRATIONS,
    integration: getIntegration,
    docsPath: (framework, featureId) =>
      getIntegration(framework)?.docs_links?.features?.[featureId]
        ?.shell_docs_path ??
      features.find((feature) => feature.id === featureId)?.shell_docs_path,
    resolveGuide: resolveFrameworkGuide,
    exclusions: SELECTED_GUIDE_EXCLUSIONS,
  };
}

export function selectedShowcaseGuideBindings(): GuideBindingCollection {
  return collectGuideBindings(selectedGuideSources());
}

// ---------------------------------------------------------------------------
// HTML carriers
// ---------------------------------------------------------------------------

export type CarrierHtml =
  /** `<Snippet>` renders this code block. */
  | { status: "code"; code: string }
  /** `<InlineDemo>` embeds the demo and its Code tab has bundled source. */
  | { status: "live" }
  /** `<FrameworkSetup>` renders this bundled setup source. */
  | { status: "setup"; source: string }
  /** The catalog marks the pair unsupported ("Not supported on ..."). */
  | { status: "unsupported" }
  /**
   * `<InlineDemo>` shows the neutral "No Showcase demo for … yet" notice:
   * the framework ships no routed demo for the cell. Fine for a sibling
   * cell; never coverage for the binding's own cell.
   */
  | { status: "no-demo" }
  /** A warning box, an empty embed, or nothing at all. */
  | { status: "missing"; reason: string };

export interface GuideCarrier {
  kind: "snippet" | "inline-demo" | "framework-setup";
  /** The source tag, whitespace-collapsed, for failure messages. */
  label: string;
  framework: string | null;
  cell: string | null;
  html: CarrierHtml;
  /**
   * The code the same tag renders for every OTHER framework that has the
   * cell, so a Markdown render that substitutes one of them is detectable.
   */
  alternatives: Array<{ framework: string; code: string }>;
}

export interface GuidePage {
  /** Raw MDX, frontmatter included. */
  source: string;
  /** Frontmatter `snippet_cell`. */
  defaultCell?: string;
  /** URL tail the page is served at (DocsPageView's `slugPath`). */
  slugPath: string;
  /** URL framework (DocsPageView's `frameworkOverride`). */
  framework: string;
}

interface BundledDemo {
  files?: unknown[];
}

const bundledDemos = (demoContent as { demos: Record<string, BundledDemo> })
  .demos;
const setupContent = setupContentData as SetupContentBundle;

const CARRIER_TAG = /<(Snippet|InlineDemo|FrameworkSetup)\b([\s\S]*?)\/>/g;
/** Props whose value decides which source renders. */
const RUNTIME_SOURCE_PROP =
  /\b(framework|cell|region|file|lines|demo|integration|concept|llmRegion)\s*=\s*\{/;
/** Shorter excerpts are too generic to attribute to one framework. */
const MIN_ATTRIBUTABLE_CODE = 20;

type SnippetProps = Parameters<typeof Snippet>[0];

function stringAttrs(inner: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of inner.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attrs;
}

function snippetProps(attrs: Record<string, string>): SnippetProps {
  const { region, file, lines, framework, cell, highlight, title } = attrs;
  return { region, file, lines, framework, cell, highlight, title };
}

function markupText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Evaluate one `<Snippet>` exactly as the HTML page does. */
function htmlSnippet(props: SnippetProps): CarrierHtml {
  const element = Snippet(props) as ReactElement<{ code?: unknown }>;
  if (
    element.type === HighlightedDynamicCodeBlock &&
    typeof element.props.code === "string"
  ) {
    return { status: "code", code: element.props.code };
  }
  if (element.type === UnsupportedBox) return { status: "unsupported" };
  return { status: "missing", reason: markupText(element) };
}

/** Evaluate one `<InlineDemo>` exactly as the HTML page does. */
function htmlInlineDemo(integration: string, demo: string | null): CarrierHtml {
  const element = docsComponents.InlineDemo({
    integration,
    demo: demo ?? undefined,
  });
  if (!element) {
    return {
      status: "missing",
      reason:
        "InlineDemo renders nothing (no demo, or unknown/undeployed integration)",
    };
  }
  if (element.type === UnsupportedBox) return { status: "unsupported" };
  if (element.type === NoShowcaseDemoBox) return { status: "no-demo" };
  // The embed's Code tab is <DemoSource>, which shows "Missing demo source"
  // when the bundle has no record, or no files, for this pair.
  if (!bundledDemos[`${integration}::${demo}`]?.files?.length) {
    return {
      status: "missing",
      reason: `Code tab shows "Missing demo source" for ${integration}::${demo}`,
    };
  }
  return { status: "live" };
}

function alternativeCode(
  cell: string,
  ownFramework: string | null,
  props: SnippetProps,
): GuideCarrier["alternatives"] {
  const alternatives: GuideCarrier["alternatives"] = [];
  for (const key of Object.keys(bundledDemos)) {
    const [framework, keyCell] = key.split("::");
    if (keyCell !== cell || framework === ownFramework) continue;
    const html = htmlSnippet({ ...props, framework, cell });
    if (html.status === "code") {
      alternatives.push({ framework, code: html.code });
    }
  }
  return alternatives;
}

function evaluateCarrier(
  name: string,
  inner: string,
  label: string,
  page: GuidePage,
): GuideCarrier {
  const attrs = stringAttrs(inner);
  const kind =
    name === "Snippet"
      ? "snippet"
      : name === "InlineDemo"
        ? "inline-demo"
        : "framework-setup";

  if (RUNTIME_SOURCE_PROP.test(inner)) {
    return {
      kind,
      label,
      framework: attrs.framework ?? page.framework,
      cell: attrs.cell ?? attrs.demo ?? null,
      html: {
        status: "missing",
        reason:
          "a source prop is a runtime expression the guard cannot evaluate",
      },
      alternatives: [],
    };
  }

  if (kind === "snippet") {
    // DocsPageView passes the URL framework and frontmatter cell as defaults.
    const props: SnippetProps = {
      ...snippetProps(attrs),
      defaultFramework: page.framework,
      defaultCell: page.defaultCell,
    };
    const framework = attrs.framework ?? page.framework;
    const cell = attrs.cell ?? page.defaultCell ?? null;
    return {
      kind,
      label,
      framework,
      cell,
      html: htmlSnippet(props),
      alternatives: cell ? alternativeCode(cell, framework, props) : [],
    };
  }

  if (kind === "inline-demo") {
    // DocsPageView: `integration={defaultFramework ?? props.integration}`.
    const demo = attrs.demo ?? null;
    return {
      kind,
      label,
      framework: page.framework,
      cell: demo,
      html: htmlInlineDemo(page.framework, demo),
      // Markdown may inline an `llmRegion` excerpt; it must be this
      // framework's, never a substitute.
      alternatives:
        demo && attrs.llmRegion
          ? alternativeCode(demo, page.framework, {
              cell: demo,
              region: attrs.llmRegion,
            })
          : [],
    };
  }

  const source = attrs.concept
    ? resolveBundledSetupConcept(page.framework, attrs.concept, setupContent)
    : null;
  return {
    kind,
    label,
    framework: page.framework,
    cell: null,
    html:
      source === null
        ? {
            status: "missing",
            reason: `FrameworkSetup renders nothing: no ${attrs.concept ?? "(no concept)"} setup is bundled for ${page.framework}`,
          }
        : { status: "setup", source },
    alternatives: [],
  };
}

/**
 * Every Showcase source carrier the HTML page renders, after the same
 * snippet inlining and framework/frontend gating DocsPageView applies.
 */
export function htmlGuideCarriers(page: GuidePage): GuideCarrier[] {
  const body = page.source.replace(/^---[\s\S]*?---\n?/, "");
  const visible = filterFrontendScopedBlocks(
    filterFrameworkScopedBlocks(
      inlineSnippets(body, page.slugPath),
      page.framework,
    ),
  );
  return [...visible.matchAll(CARRIER_TAG)].map(([tag, name, inner]) =>
    evaluateCarrier(name, inner, tag.replace(/\s+/g, " "), page),
  );
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

type GuideRef = Pick<
  SelectedShowcaseGuideBinding,
  "framework" | "slugPath" | "contentSlugPath"
>;

/** The binding's raw Markdown, rendered as the `llms-mdx` route does. */
export function renderGuideMarkdown(binding: GuideRef): string {
  const doc = loadDoc(binding.contentSlugPath);
  if (!doc) {
    throw new Error(`Missing effective guide: ${binding.contentSlugPath}`);
  }
  return renderPageToLlmText(
    {
      url: `${binding.framework}/${binding.slugPath}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: binding.contentSlugPath,
      framework: binding.framework,
    },
    { framework: binding.framework },
  );
}

export interface RenderedGuide {
  markdown: string;
  carriers: GuideCarrier[];
}

/** Render the binding's page both ways. */
export function renderSelectedGuide(binding: GuideRef): RenderedGuide {
  const doc = loadDoc(binding.contentSlugPath);
  if (!doc) {
    throw new Error(`Missing effective guide: ${binding.contentSlugPath}`);
  }
  return {
    markdown: renderGuideMarkdown(binding),
    carriers: htmlGuideCarriers({
      source: doc.source,
      defaultCell: doc.fm.defaultCell,
      slugPath: binding.slugPath,
      framework: binding.framework,
    }),
  };
}

/** `<!-- snippet skipped: … -->`, `<!-- setup skipped: … -->`, and kin. */
const MARKDOWN_SKIP_MARKER = /<!--[^>]*?\bskipped:[^>]*?-->/g;
const MARKDOWN_UNSUPPORTED_NOTICE = /^> \*\*Not supported on /gm;
const UNRESOLVED_MARKDOWN_TAGS = ["<Snippet", "<FrameworkSetup", "<InlineDemo"];

/** Places where raw Markdown dropped Showcase source it should carry. */
export function markdownSourceGaps(markdown: string): string[] {
  const gaps = [...markdown.matchAll(MARKDOWN_SKIP_MARKER)].map(
    ([marker]) => `Markdown marker ${marker}`,
  );
  for (const tag of UNRESOLVED_MARKDOWN_TAGS) {
    if (markdown.includes(tag)) gaps.push(`Markdown leaves ${tag} unresolved`);
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

type AuditedBinding = Pick<
  SelectedShowcaseGuideBinding,
  "framework" | "cell" | "contentSlugPath"
>;

function carrierPair(carrier: GuideCarrier): string {
  return `${carrier.framework ?? "(none)"}::${carrier.cell ?? "(none)"}`;
}

/**
 * Check one runnable binding's HTML carriers and Markdown.
 * `declaredUnsupported` holds the cells the binding's framework declares
 * unsupported in its manifest.
 */
export function auditRenderedGuide(
  binding: AuditedBinding,
  guide: RenderedGuide,
  declaredUnsupported: ReadonlySet<string>,
): string[] {
  const failures = markdownSourceGaps(guide.markdown);
  const ownSource = guide.carriers.flatMap((carrier) =>
    carrier.html.status === "code"
      ? [carrier.html.code]
      : carrier.html.status === "setup"
        ? [carrier.html.source]
        : [],
  );

  for (const carrier of guide.carriers) {
    const pair = carrierPair(carrier);
    if (carrier.framework !== binding.framework) {
      failures.push(
        `${carrier.label} renders ${pair}, not ${binding.framework}`,
      );
    }
    const { html } = carrier;
    if (html.status === "missing") {
      failures.push(`HTML ${carrier.label}: ${html.reason}`);
    }
    if (html.status === "no-demo" && carrier.cell === binding.cell) {
      failures.push(
        `HTML ${carrier.label} says there is no Showcase demo for its own cell ${pair}`,
      );
    }
    if (
      html.status === "unsupported" &&
      (carrier.cell === null || !declaredUnsupported.has(carrier.cell))
    ) {
      failures.push(
        `HTML ${carrier.label} says "Not supported" for ${pair}, which ${binding.framework} does not declare unsupported`,
      );
    }
    if (html.status === "code" && !guide.markdown.includes(html.code)) {
      failures.push(
        `Markdown lacks the code HTML renders for ${carrier.label} (${pair})`,
      );
    }
    for (const alternative of carrier.alternatives) {
      if (alternative.framework === binding.framework) continue;
      if (alternative.code.trim().length < MIN_ATTRIBUTABLE_CODE) continue;
      if (ownSource.some((source) => source.includes(alternative.code))) {
        continue;
      }
      if (guide.markdown.includes(alternative.code)) {
        failures.push(
          `Markdown renders ${alternative.framework} code for ${carrier.label}`,
        );
      }
    }
  }

  const covered = guide.carriers.some(
    (carrier) =>
      (carrier.kind === "snippet" || carrier.kind === "inline-demo") &&
      carrier.framework === binding.framework &&
      carrier.cell === binding.cell &&
      (carrier.html.status === "code" || carrier.html.status === "live"),
  );
  if (!covered) {
    const rendered = [
      ...new Set(
        guide.carriers
          .filter((carrier) => carrier.kind !== "framework-setup")
          .map(carrierPair),
      ),
    ];
    failures.push(
      `renders no ${binding.framework}::${binding.cell} Snippet or InlineDemo (page carries: ${rendered.join(", ") || "none"})`,
    );
  }

  const htmlNotices = guide.carriers.filter(
    (carrier) => carrier.html.status === "unsupported",
  ).length;
  const markdownNotices = (
    guide.markdown.match(MARKDOWN_UNSUPPORTED_NOTICE) ?? []
  ).length;
  if (markdownNotices !== htmlNotices) {
    failures.push(
      `Markdown shows ${markdownNotices} "Not supported" notice(s); HTML shows ${htmlNotices}`,
    );
  }
  const htmlNoDemo = guide.carriers.filter(
    (carrier) => carrier.html.status === "no-demo",
  ).length;
  const markdownNoDemo = (guide.markdown.match(NO_SHOWCASE_DEMO_MARKDOWN) ?? [])
    .length;
  if (markdownNoDemo !== htmlNoDemo) {
    failures.push(
      `Markdown shows ${markdownNoDemo} "No Showcase demo" notice(s); HTML shows ${htmlNoDemo}`,
    );
  }

  const prefix = `${binding.framework}:${binding.cell} -> ${binding.contentSlugPath}`;
  return failures.map((failure) => `${prefix}: ${failure}`);
}

/**
 * A command-only cell (cli-start) has no runnable route to embed. Its guide
 * must be the framework's own quickstart, not a root or sibling fallback, and
 * its Markdown must carry every source it references.
 */
export function auditCommandGuide(
  binding: AuditedBinding,
  markdown: string,
  docsFolder: string,
): string[] {
  const failures = markdownSourceGaps(markdown);
  const expected = `integrations/${docsFolder}/quickstart`;
  if (binding.contentSlugPath !== expected) {
    failures.push(`resolves to ${binding.contentSlugPath}, not ${expected}`);
  }
  const prefix = `${binding.framework}:${binding.cell} -> ${binding.contentSlugPath}`;
  return failures.map((failure) => `${prefix}: ${failure}`);
}
