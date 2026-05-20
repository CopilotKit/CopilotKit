import type { ReactNode } from "react";

import { FrameworkOverview } from "./framework-overview";
import type {
  FrameworkOverviewData,
  LiveDemo,
  SupportedFeature,
} from "@/data/frameworks/types";

/**
 * MDX-friendly adapter for `<FrameworkOverview>`. Accepts the flat props
 * the v1 docs MDX uses (e.g. `frameworkName`, `frameworkIcon`, `header`,
 * `supportedFeatures`, ...) and renders the existing data-driven
 * `FrameworkOverview` component with a synthesized `FrameworkOverviewData`.
 *
 * Why this exists: `docs_mode: authored` frameworks ship their own
 * `integrations/<folder>/index.mdx` ported from v1, which uses flat
 * props that don't match the typed `data: FrameworkOverviewData` shape
 * the data-driven path uses. Without this adapter, MDX `<FrameworkOverview>`
 * would render as the registry shim (empty div + children) and the
 * ported props would be dropped on the floor.
 *
 * The icon is passed through as a JSX node via `iconOverride`, so MDX
 * files keep using `frameworkIcon={<MastraIcon className="..." />}`
 * without needing to know about the iconKey registry.
 *
 * `currentFramework` is the URL framework slug (e.g. `langgraph-fastapi`)
 * supplied by the page render site via a per-render override of this
 * component in the MDX components map. It feeds into
 * `FrameworkOverview`'s `rewriteHref` link rewriter so internal links
 * and feature-viewer URLs land on the URL-active variant. Two cases:
 *
 *   1. Same-slug case (e.g. `/mastra` rendering `integrations/mastra/index.mdx`,
 *      where the MDX's `guideLink="/mastra/quickstart"` already embeds the
 *      URL slug). `fromSlug === toSlug` → `rewriteHref` short-circuits and
 *      every link passes through unchanged.
 *   2. Shared-folder case (e.g. `/langgraph-fastapi` rendering
 *      `integrations/langgraph/index.mdx`, where the MDX embeds
 *      `/langgraph/...` and we need to rewrite to `/langgraph-fastapi/...`).
 *      Without this prop the adapter passed an empty `currentFramework`,
 *      so the rewriter stripped `/langgraph/` entirely (toSlug was empty),
 *      producing broken `//` URLs.
 *
 * Fallback: when the page render site doesn't override this component
 * (e.g. an MDX rendered outside the framework-scoped router), we derive
 * the slug from `guideLink` itself — that makes `fromSlug === toSlug`
 * so the rewriter no-ops, preserving the historical empty-slug behavior
 * for the same-slug case.
 */
export interface MdxFrameworkOverviewProps {
  frameworkName: string;
  frameworkIcon?: ReactNode;
  header: string;
  subheader?: string;
  bannerVideo?: string;
  guideLink?: string;
  initCommand?: string;
  featuresLink?: string;
  supportedFeatures?: SupportedFeature[];
  architectureImage?: string;
  architectureVideo?: string;
  liveDemos?: LiveDemo[];
  tutorialLink?: string;
  /**
   * URL framework slug bound by the per-render override in
   * `app/[framework]/[[...slug]]/page.tsx` (see header comment). Authored
   * MDX never sets this directly — the render site injects it via the
   * components map so the rewriter has the URL-active variant to rewrite
   * toward.
   */
  currentFramework?: string;
}

export function MdxFrameworkOverview(props: MdxFrameworkOverviewProps) {
  // Derive the "from" slug embedded in guideLink so the fallback path
  // (no `currentFramework` from the render site) makes rewriteHref a
  // no-op. Mirrors `FrameworkOverview`'s own `fromSlug` derivation.
  const guideLinkSlug = (props.guideLink ?? "").split("/")[1] ?? "";
  const currentFramework = props.currentFramework ?? guideLinkSlug;
  const synthData: FrameworkOverviewData = {
    // slug is only used by FrameworkOverview's link-rewriting logic to
    // strip a "from-slug" prefix off internal links. We pass an empty
    // string here because the `data.slug` field is no longer the source
    // of truth for the rewriter — `FrameworkOverview` derives `fromSlug`
    // from `guideLink` directly. Leaving this empty avoids a stale
    // duplicate of the prefix.
    slug: "",
    frameworkName: props.frameworkName,
    // iconKey is ignored because we always pass `iconOverride` below.
    iconKey: "",
    header: props.header,
    subheader: props.subheader ?? "",
    bannerVideo: props.bannerVideo,
    guideLink: props.guideLink ?? "",
    initCommand: props.initCommand ?? "npx copilotkit@latest init",
    featuresLink: props.featuresLink ?? "",
    supportedFeatures: props.supportedFeatures ?? [],
    architectureImage: props.architectureImage,
    architectureVideo: props.architectureVideo,
    liveDemos: props.liveDemos ?? [],
    tutorialLink: props.tutorialLink,
  };
  return (
    <FrameworkOverview
      data={synthData}
      currentFramework={currentFramework}
      iconOverride={props.frameworkIcon}
    />
  );
}
