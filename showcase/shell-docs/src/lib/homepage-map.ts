// homepage-map.ts — everything the docs homepage product map renders.
//
// The map's components are deliberately dumb: all copy, every destination and
// every icon choice lives here, so a reviewer can check the page's wording and
// links in one file instead of four.
//
// Icon rule: each capability uses the icon its destination page already
// declares in its frontmatter or `meta.json`. Inventing a second symbol for a
// concept the docs already illustrate is how a design drifts.

import { ROOT_FRAMEWORK, getDocsMode, getIntegrations } from "@/lib/registry";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { FRONTEND_OPTIONS } from "@/lib/frontend-options";

/** Icon names used by the map. Every one is a real `lucide-react` export. */
export type LucideIconName =
  | "MessageSquare"
  | "Paintbrush"
  | "User"
  | "Settings"
  | "Repeat"
  | "Wrench"
  | "MessageSquareMore"
  | "Brain"
  | "Sparkles"
  | "SearchCheck"
  | "BarChart3"
  | "Server";

export interface MapCapability {
  readonly title: string;
  readonly body: string;
  /** Root-surface path, or an absolute URL for destinations outside the docs. */
  readonly href: string;
  readonly icon: LucideIconName;
}

export interface MapPick {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  /** Shown as a small qualifier when the choice carries a condition. */
  readonly note?: string;
}

/** Icons here match: chat.mdx, generative-ui/meta.json, human-in-the-loop,
 *  headless-ui.mdx, shared-state.mdx, frontend-tools.mdx. */
export const COPILOTKIT_CAPABILITIES: readonly MapCapability[] = [
  {
    title: "Chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    href: "/prebuilt-components/chat",
    icon: "MessageSquare",
  },
  {
    title: "Generative UI",
    body: "Your agent returns real React components, not just text.",
    href: "/generative-ui",
    icon: "Paintbrush",
  },
  {
    title: "Approvals",
    body: "Pause for the user's decision at the steps that matter.",
    href: "/human-in-the-loop",
    icon: "User",
  },
  {
    title: "Headless UI",
    body: "Own every pixel and keep the agent runtime.",
    href: "/custom-look-and-feel/headless-ui",
    icon: "Settings",
  },
  {
    title: "Shared state",
    body: "Your app and your agent see the same thing, live.",
    href: "/shared-state",
    icon: "Repeat",
  },
  {
    title: "Frontend tools",
    body: "Let the agent call functions that live in your app.",
    href: "/frontend-tools",
    icon: "Wrench",
  },
] as const;

/** Icons here match: threads.mdx, memories.mdx, learning.mdx, inspector.mdx,
 *  self-hosting.mdx. Analytics has no docs page; `BarChart3` matches the
 *  choice `IntelligenceFeatureCards` already made for it. */
export const INTELLIGENCE_CAPABILITIES: readonly MapCapability[] = [
  {
    title: "Rich Threads",
    body: "Conversations survive reloads, devices, and sessions.",
    href: "/threads",
    icon: "MessageSquareMore",
  },
  {
    title: "Memory",
    body: "Durable facts and preferences across conversations.",
    href: "/intelligence/memories",
    icon: "Brain",
  },
  {
    title: "Learning",
    body: "Completed threads become reviewed, reusable Skills.",
    href: "/learning",
    icon: "Sparkles",
  },
  {
    title: "Inspector",
    body: "Replay any run and see every event and state change.",
    href: "/inspector",
    icon: "SearchCheck",
  },
  {
    title: "Analytics",
    body: "Where users get value, from the same interaction data.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
    icon: "BarChart3",
  },
  {
    title: "Self-hosting",
    body: "The same platform inside your own cluster or VPC.",
    href: "/intelligence/self-hosting",
    icon: "Server",
  },
] as const;

/** Frontends that are managed channels and therefore require Intelligence. */
const INTELLIGENCE_ONLY_FRONTENDS = new Set(["slack", "teams"]);

/**
 * `ROOT_FRAMEWORK`'s docs are served at the root URL surface, so its pages
 * take no prefix; every other framework lives under `/<slug>/`. The
 * absolute-URL guard is this function's own addition, not inherited from the
 * v1 `docs-build-with.tsx` this map replaces: without it, an external
 * Analytics link would get framework-prefixed into a broken path like
 * `/mastra/https://...` instead of being returned untouched.
 *
 * Contract: only `COPILOTKIT_CAPABILITIES` hrefs are framework-scoped. The
 * `INTELLIGENCE_CAPABILITIES` are platform pages with one canonical
 * location — `scopedHref("/intelligence/memories", "mastra")` would produce
 * a path no page is served at, so callers must not run Intelligence hrefs
 * through this function.
 */
export function scopedHref(href: string, slug: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return slug === ROOT_FRAMEWORK ? href : `/${slug}${href}`;
}

/**
 * The documented frontends. `react` is the default surface and its guide is
 * the root quickstart; the rest are served unprefixed at `/<id>` — there is no
 * `/frontends` index page, so nothing links to one.
 */
export function frontendPicks(): MapPick[] {
  return FRONTEND_OPTIONS.map((option) => ({
    id: option.id,
    name: option.name,
    href: option.id === "react" ? "/quickstart" : `/${option.id}`,
    ...(INTELLIGENCE_ONLY_FRONTENDS.has(option.id)
      ? { note: "needs Intelligence" }
      : {}),
  }));
}

/**
 * Every integration that has docs, built-in agent first. `docs_mode: hidden`
 * integrations are dropped because linking them lands on a 404 — the same
 * filter the v1 framework grid used.
 */
export function agentPicks(): MapPick[] {
  return getIntegrations()
    .filter((integration) => getDocsMode(integration.slug) !== "hidden")
    .sort((a, b) => {
      if (a.slug === ROOT_FRAMEWORK) return -1;
      if (b.slug === ROOT_FRAMEWORK) return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    })
    .map((integration) => ({
      id: integration.slug,
      name: integration.name,
      href:
        integration.slug === ROOT_FRAMEWORK
          ? "/quickstart"
          : `/${integration.slug}`,
    }));
}
