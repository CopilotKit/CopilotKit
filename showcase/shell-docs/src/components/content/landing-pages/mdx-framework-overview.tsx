import { type ReactNode } from "react";

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
}

export function MdxFrameworkOverview(props: MdxFrameworkOverviewProps) {
  const synthData: FrameworkOverviewData = {
    // slug is only used by FrameworkOverview's link-rewriting logic to
    // strip a "from-slug" prefix off internal links. Authored MDX writes
    // links with the framework's own slug already in place (no rewriting
    // needed), so an empty slug here is a no-op for rewriteHref().
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
      currentFramework={synthData.slug}
      iconOverride={props.frameworkIcon}
    />
  );
}
