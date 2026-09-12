import type { ReactNode } from "react";

/** Resolved at render time via the icon registry in Track B's port. */
export type IconKey = string;

export interface SupportedFeature {
  title: string;
  description: string;
  /**
   * Lucide icon name for the capability card, matching the icon the linked
   * docs section carries in its own nav entry (Generative UI is Paintbrush,
   * human-in-the-loop is User, shared state is Repeat). Resolved through
   * `CAPABILITY_ICONS` in `framework-overview.tsx`; an unlisted name renders
   * no icon rather than throwing.
   */
  iconKey?: string;
  documentationLink: string;
  demoLink?: string;
  /** Optional: a2a's sole feature item omits a videoUrl. */
  videoUrl?: string;
}

export type LiveDemoType = "saas" | "canvas" | "feature-viewer" | string;

export interface LiveDemo {
  type: LiveDemoType;
  title: string;
  description: string;
  iframeUrl: string;
}

export interface OpsPlatformCTAData {
  variant: "card" | "banner";
  title: string;
  body: string;
  ctaLabel: string;
  surface: string;
}

/**
 * One runnable cell on showcase.copilotkit.ai, addressed as
 * `/<frontend>/<integration>/<demo>`. Docs always embed the React frontend
 * (see `SHOWCASE_FRONTEND`), so only the integration and demo vary.
 */
export interface ShowcaseDemo {
  /** Route segment, e.g. "agentic-chat". Must exist in the integration's manifest. */
  slug: string;
  /** Label as the showcase itself names the cell, e.g. "Shared State: Streaming". */
  title: string;
}

export interface ShowcaseSection {
  /**
   * Showcase integration slug. Not always the docs slug — the showcase has no
   * `a2a` or `agent-spec` integration, and `strands-typescript` is its own cell
   * there while sharing the `aws-strands` docs folder.
   */
  integration: string;
  /**
   * Per-URL override of `integration`, for records and MDX files that serve
   * several framework slugs. `/langgraph-typescript` should embed the
   * TypeScript cell, not the Python one whose record it shares. Only slugs
   * with a verified running cell belong here; anything unlisted falls back to
   * `integration`.
   */
  integrationBySlug?: Record<string, string>;
  /** One sentence introducing the embed. */
  intro: string;
  demos: ShowcaseDemo[];
}

/**
 * The "Connect your agent" section — the one place on the page that shows
 * code. Snippets are copied from the framework's own runtime or quickstart
 * page rather than written fresh, so the landing page cannot drift away from
 * the guide it links to.
 */
export interface ConnectSection {
  /** One or two sentences: where the agent stays, how CopilotKit reaches it. */
  intro: string;
  /** Path shown above the snippet, e.g. "app/api/copilotkit/route.ts". */
  filename: string;
  /**
   * Snippet body. Data records set it; authored MDX leaves it out and supplies
   * a fenced code block as the component's children instead — see
   * `FrameworkOverviewProps.connectSnippet`.
   */
  code?: string;
  /** Fenced-code language tag; defaults to "ts". */
  language?: string;
  /** Link to the full setup guide. */
  guideLink: string;
  /**
   * Setup command for frameworks whose init is not the generic CLI one — a2a
   * clones a repository, the Claude Agent SDK records pass
   * `init --framework claude-sdk-*`. Rendered as a copyable chip beside the
   * snippet, which is where a reader looks for it. Frameworks on the generic
   * command omit it: it already sits behind the hero's onboarding prompt.
   */
  initCommand?: string;
}

export interface FrameworkOverviewData {
  /** Canonical slug per SLUG_RENAMES (e.g., "langgraph-python"). */
  slug: string;
  frameworkName: string;
  iconKey: IconKey;
  header: string;
  subheader: string;
  /** Optional: a2a omits the banner video entirely. */
  bannerVideo?: string;
  guideLink: string;
  initCommand: string;
  featuresLink: string;
  supportedFeatures: SupportedFeature[];
  /** Optional: crewai-flows ships an architectureVideo instead. */
  architectureImage?: string;
  /** Optional alternative to architectureImage; crewai-flows uses this. */
  architectureVideo?: string;
  liveDemos: LiveDemo[];
  tutorialLink?: string;
  cta?: OpsPlatformCTAData;
  /**
   * If true, the route loads
   * `src/content/framework-overviews/<slug>/after-features.mdx`
   * and renders it into the `afterFeatures` slot.
   */
  hasAfterFeaturesMdx?: boolean;

  /**
   * Two or three sentences opening the capability section: what the framework
   * gives you on its own, and what it leaves to the application.
   *
   * Supplying this switches the page to the capability-card layout. Records
   * without it keep the older video-per-feature list, so both layouts can
   * coexist while the partner pages are migrated one at a time — no partner
   * page is ever half-built in the branch.
   */
  lede?: string;
  /**
   * One sentence naming the capabilities that did not get a card, so the three
   * cards do not read as the complete list.
   */
  capabilitiesFootnote?: {
    text: string;
    linkLabel: string;
    href: string;
  };
  connect?: ConnectSection;
  showcase?: ShowcaseSection;
}
