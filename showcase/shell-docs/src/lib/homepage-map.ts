// homepage-map.ts — the data behind the homepage setup wizard.
//
// The homepage is a four-step wizard: pick a frontend, pick features, pick an
// agent backend, then copy a prompt that carries all three selections. This
// module owns every option the wizard can show — its copy and its icon — so
// a reviewer can check the wizard's wording in one file instead of four. None
// of these are destinations any more: the wizard's steps are selections, not
// links, so nothing here carries an `href`.
//
// Icon rule: each capability uses the icon its docs page already declares in
// its frontmatter or `meta.json`. Inventing a second symbol for a concept the
// docs already illustrate is how a design drifts.

import { ROOT_FRAMEWORK, getDocsMode, getIntegrations } from "@/lib/registry";
import type { Integration } from "@/lib/registry";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { FRONTEND_OPTIONS } from "@/lib/frontend-options";
import type { FrontendIcon, FrontendId } from "@/lib/frontend-options";

/** Icon names used by the map. Every one is a real `lucide-react` export. */
export type LucideIconName =
  | "MessageSquare"
  | "Paintbrush"
  | "User"
  | "Settings"
  | "Repeat"
  | "Wrench";

export interface MapCapability {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly icon: LucideIconName;
}

/**
 * What a pick needs to draw its logo. Discriminated by `kind` so `PickGrid`
 * stays dumb: it forwards the payload to the matching logo component and
 * never decides which logo a pick gets. Frontends are identified by their
 * `FrontendIcon` id, agents by their registry slug plus the registry's own
 * `logo` URL, which `FrameworkLogo` falls back to when no bundled mark
 * matches the slug.
 */
export type MapPickLogo =
  | { readonly kind: "frontend"; readonly icon: FrontendIcon }
  | {
      readonly kind: "framework";
      readonly slug: string;
      readonly fallbackSrc?: string;
    };

export interface MapPick {
  readonly id: string;
  readonly name: string;
  readonly logo: MapPickLogo;
  readonly summary?: string;
}

/**
 * Icons here match: chat.mdx, generative-ui/meta.json, human-in-the-loop,
 * headless-ui.mdx, shared-state.mdx, frontend-tools.mdx.
 *
 * `id` is mirrored into the wizard's URL query string so a shared link
 * reproduces the same feature selection — treat these ids as a stable
 * contract: a link already shared with an id breaks if that id is renamed.
 */
export const COPILOTKIT_CAPABILITIES: readonly MapCapability[] = [
  {
    id: "chat",
    title: "Chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    icon: "MessageSquare",
  },
  {
    id: "gen-ui",
    title: "Generative UI",
    body: "Your agent returns real React components, not just text.",
    icon: "Paintbrush",
  },
  {
    id: "hitl",
    title: "Human in the loop",
    body: "Pause for the user's decision at the steps that matter.",
    icon: "User",
  },
  {
    id: "headless",
    title: "Headless UI",
    body: "Own every pixel and keep the agent runtime.",
    icon: "Settings",
  },
  {
    id: "state",
    title: "Shared state",
    body: "Your app and your agent see the same thing, live.",
    icon: "Repeat",
  },
  {
    id: "tools",
    title: "Frontend tools",
    body: "Let the agent call functions that live in your app.",
    icon: "Wrench",
  },
] as const;

/**
 * Frontends excluded from the wizard's frontend step. This is an editorial
 * call, not a technical one: `onboardingFrontendSlug` already returns
 * undefined for both `slack` and `teams`, so nothing forces this filter. They
 * are excluded because they are managed channels that require Intelligence,
 * and Intelligence is no longer on this page.
 */
const NON_WIZARD_FRONTENDS = new Set(["slack", "teams"]);

/**
 * Overrides `FrontendOption.summary` for picks where the registry's own
 * copy doesn't fit a wizard tile. `react`'s registry summary — "The
 * complete CopilotKit docs experience." — is written for the docs
 * framework switcher and describes the docs *site*, not the frontend; on a
 * setup-wizard picker tile next to Vue, React Native and Angular it reads
 * as nonsense. Every other id is left out on purpose so it keeps reading
 * straight from the registry and stays in step with it automatically.
 */
const FRONTEND_SUMMARY_OVERRIDES: Partial<Record<FrontendId, string>> = {
  react: "The React provider, hooks, and UI components for CopilotKit.",
};

/**
 * The frontends the wizard can pick, minus the managed channels (see
 * `NON_WIZARD_FRONTENDS`).
 */
export function frontendPicks(): MapPick[] {
  return FRONTEND_OPTIONS.filter(
    (option) => !NON_WIZARD_FRONTENDS.has(option.id),
  ).map((option) => ({
    id: option.id,
    name: option.name,
    logo: { kind: "frontend", icon: option.icon },
    summary: FRONTEND_SUMMARY_OVERRIDES[option.id] ?? option.summary,
  }));
}

/**
 * Every integration that has a docs surface on this site. `docs_mode:
 * hidden` integrations are dropped because linking them lands on a 404 —
 * the same filter the v1 framework grid used. This is the single source of
 * truth for that rule: the homepage path has three call sites that need
 * exactly this set (this module's own `agentPicks`, the product map's
 * per-slug validation record, and the hero's quickstart framework picker),
 * and they must all agree on which integrations exist.
 */
export function visibleIntegrations(): Integration[] {
  return getIntegrations().filter(
    (integration) => getDocsMode(integration.slug) !== "hidden",
  );
}

/**
 * Every integration that has docs, built-in agent first.
 */
export function agentPicks(): MapPick[] {
  return visibleIntegrations()
    .sort((a, b) => {
      if (a.slug === ROOT_FRAMEWORK) return -1;
      if (b.slug === ROOT_FRAMEWORK) return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    })
    .map((integration) => ({
      id: integration.slug,
      name: integration.name,
      logo: {
        kind: "framework",
        slug: integration.slug,
        fallbackSrc: integration.logo,
      },
    }));
}
