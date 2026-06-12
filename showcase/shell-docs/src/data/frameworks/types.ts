import type { ReactNode } from "react";

/** Resolved at render time via the icon registry in Track B's port. */
export type IconKey = string;

export interface SupportedFeature {
  title: string;
  description: string;
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
}
