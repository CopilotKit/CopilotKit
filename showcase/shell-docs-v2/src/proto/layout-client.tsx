"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  BackendGlyph,
  CookbookGlyph,
  DeclarativeUIGlyph,
  FrontendToolsGlyph,
  GenerativeUIGlyph,
  HumanInTheLoopGlyph,
  IntelligenceGlyph,
  MCPAppsGlyph,
  OpenGenUIGlyph,
  SharedStateGlyph,
  SubagentsGlyph,
  VoiceGlyph,
  LearningGlyph,
  MemoryGlyph,
  QuickstartGlyph,
  ReferenceGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import { SiDiscord, SiX } from "react-icons/si";
import type { LinkItemType } from "fumadocs-ui/layouts/shared";
// Spacious' DocsLayout with the CopilotKit "Ask AI" chat in its aiChat slot.
import { DocsLayout as SpaciousLayout } from "@/components/ai/docs-layout";
import { ProtoStackAgent } from "@/components/ai/stack-agents";
import { DocsChatProvider } from "@/components/ai/chat-session";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import { Button } from "@/components/ui/button";
import { PanelActions } from "@/components/layout/panel-actions";
import { AdaptiveThemeSwitch } from "@/components/layout/theme-toggle";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FRAMEWORKS } from "./data";
import examples from "./examples.json";
import { rememberFramework, useLastFramework } from "./last-framework";
import { frameworkHref, locationFromPathname, type VariantId } from "./routes";
import { SidebarTop, buildTree, layoutTabs } from "./variants";
import { liveTree } from "./live-tree";
import { trackEvent } from "@/lib/telemetry/analytics";
import type { LiveNav } from "@/lib/live-nav";
import { ROOT_FRAMEWORK, scopeFromPath } from "@/lib/live-scope";
import { variantMeta } from "./meta";

const GITHUB = "https://github.com/CopilotKit/CopilotKit";

const DISCORD: LinkItemType = {
  type: "icon",
  text: "Discord",
  label: "Discord",
  url: "https://discord.gg/6dffbvGU3D",
  icon: <SiDiscord />,
  external: true,
};

const X: LinkItemType = {
  type: "icon",
  text: "X",
  label: "CopilotKit on X",
  url: "https://x.com/CopilotKit",
  icon: <SiX />,
  external: true,
};

const INTELLIGENCE_MENU = [
  {
    text: "Overview",
    url: "/intelligence/overview",
    icon: <IntelligenceGlyph />,
    description: "What Intelligence adds to an agent app in production.",
  },
  {
    text: "Quickstart",
    url: "/intelligence/quickstart",
    icon: <QuickstartGlyph />,
    description: "Turn on Intelligence in your runtime.",
  },
  {
    text: "AG-UI Streams",
    url: "/AG-UI-Streams",
    icon: <ThreadsGlyph />,
    description: "Threads that persist with their generative UI.",
  },
  {
    text: "Automatic learning",
    url: "/learning",
    icon: <LearningGlyph />,
    description: "Agents that learn from real use.",
  },
  {
    text: "User memories",
    url: "/intelligence/memories",
    icon: <MemoryGlyph />,
    description: "Remember each user across conversations.",
  },
  {
    text: "Self-hosted",
    url: "/intelligence/self-hosting",
    icon: <BackendGlyph />,
    description: "Run Intelligence in your own infrastructure.",
  },
];

/**
 * Puts a navbar dropdown on the website's lilac-grey tray: a hidden marker
 * that theme.css finds to recolor Fumadocs' own popup, so the tray keeps the
 * popup's rounding and resize animation. Hidden, it takes no grid cell.
 */
const MENU_TRAY: Extract<LinkItemType, { type: "custom" }> = {
  type: "custom",
  children: <span data-menu-tray hidden />,
};

/**
 * A menu card's hover, as on the home's link cards: it stays white and takes
 * the website's lilac edge and the lift, since Fumadocs' grey hover fill is
 * nearly the tray's own color.
 */
const HOVER = "hover:border-edge-action hover:bg-fd-card hover:shadow-lift";

/** Topic cards: the glyph turns lilac with the hover, too. */
const CARD = {
  className: `${HOVER} [&_svg]:transition-colors hover:[&_svg]:text-fd-primary`,
};

/** One-line rows for the long framework menus: logo, name, and a count. */
const ROW = {
  className: `${HOVER} flex-row items-center gap-2.5 p-2.5 [&>p]:text-sm [&>p:last-child]:ms-auto [&>p:last-child]:text-xs`,
};

/**
 * The Examples menu: nine demos worth opening first (three even columns), each a live showcase demo
 * in the playground (it opens on your framework). Ids are showcase feature
 * ids (src/proto/examples.json).
 */
const FEATURED_EXAMPLES = [
  {
    id: "gen-ui-tool-based",
    title: "Generative UI",
    description: "The agent renders your typed React components.",
    icon: <GenerativeUIGlyph />,
  },
  {
    id: "open-gen-ui",
    title: "Open-ended UI",
    description: "The agent builds UI from any component library.",
    icon: <OpenGenUIGlyph />,
  },
  {
    id: "declarative-gen-ui",
    title: "A2UI",
    description: "Declarative UI from your own component catalog.",
    icon: <DeclarativeUIGlyph />,
  },
  {
    id: "mcp-apps",
    title: "MCP Apps",
    description: "MCP servers that bring their own UI.",
    icon: <MCPAppsGlyph />,
  },
  {
    id: "hitl-in-chat",
    title: "Human in the loop",
    description: "An approval card inline in the chat.",
    icon: <HumanInTheLoopGlyph />,
  },
  {
    id: "frontend-tools",
    title: "Frontend tools",
    description: "The agent takes actions in your app.",
    icon: <FrontendToolsGlyph />,
  },
  {
    id: "shared-state-read-write",
    title: "Shared state",
    description: "Your UI and the agent edit the same state.",
    icon: <SharedStateGlyph />,
  },
  {
    id: "subagents",
    title: "Sub-agents",
    description: "An agent that delegates work to others.",
    icon: <SubagentsGlyph />,
  },
  {
    id: "voice",
    title: "Voice",
    description: "Talk to the agent in real time.",
    icon: <VoiceGlyph />,
  },
].filter((e) => examples.features.some((f) => f.id === e.id));

/** A compact menu card: glyph tile, title, and a one-line description. */
function MenuRow({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-fd-muted [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-fd-muted-foreground">
          {description}
        </span>
      </span>
    </>
  );
}

/** Prototype D's home: Fumadocs' navbar-only Home Layout. */
function DHomeLayout({ children }: { children: ReactNode }) {
  const [framework] = useLastFramework();
  const links: LinkItemType[] = [
    {
      type: "menu",
      text: "Guides",
      items: [
        {
          text: "Quickstart",
          description: "Add a chat to your app and connect it to your agent.",
          url: frameworkHref("d", framework, "quickstart"),
          icon: <QuickstartGlyph />,
          menu: CARD,
        },
        {
          text: "Cookbook",
          description: "Recipes for common patterns, start to finish.",
          url: "/cookbook",
          icon: <CookbookGlyph />,
          menu: CARD,
        },
        {
          text: "Reference",
          description: "Every hook, component, and runtime API.",
          url: "/reference",
          icon: <ReferenceGlyph />,
          menu: CARD,
        },
        MENU_TRAY,
      ],
    },
    {
      type: "menu",
      text: "Integrations",
      items: [
        ...FRAMEWORKS.map((f) => ({
          text: f.name,
          url: frameworkHref("d", f.id, "quickstart"),
          menu: { ...ROW, banner: <FrameworkLogo slug={f.id} size={18} /> },
        })),
        MENU_TRAY,
      ],
    },
    {
      type: "menu",
      text: "Examples",
      url: "/examples",
      items: [
        ...FEATURED_EXAMPLES.map((e) => ({
          text: e.title,
          url: `/examples?feature=${e.id}`,
          menu: {
            className: `${CARD.className} flex-row items-center gap-3 p-2.5`,
            children: <MenuRow {...e} />,
          },
        })),
        MENU_TRAY,
      ],
    },
    {
      type: "menu",
      text: "Intelligence",
      items: [
        ...INTELLIGENCE_MENU.map((i) => ({
          text: i.text,
          description: i.description,
          url: i.url,
          icon: i.icon,
          menu: CARD,
        })),
        MENU_TRAY,
      ],
    },
    {
      // A custom item so the button can match the navbar's pill search.
      type: "custom",
      secondary: true,
      children: (
        <Button
          render={
            <a
              href="https://www.copilotkit.ai/talk-to-an-engineer"
              target="_blank"
              rel="noreferrer noopener"
            />
          }
          nativeButton={false}
          onClick={() =>
            trackEvent("talk_to_us_clicked", { location: "docs_nav" })
          }
          className="h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/85"
        >
          Talk to an engineer
        </Button>
      ),
    },
  ];
  return (
    <HomeLayout
      nav={{
        title: <CopilotKitLogo className="h-[22px] w-auto" />,
        url: "/",
      }}
      links={links}
      githubUrl={GITHUB}
      slots={{ themeSwitch: AdaptiveThemeSwitch }}
    >
      {children}
    </HomeLayout>
  );
}

export function ProtoLayout({
  ...props
}: {
  variant: VariantId;
  liveNav?: LiveNav;
  children: ReactNode;
}) {
  return (
    <DocsChatProvider>
      <ProtoLayoutContent {...props} />
    </DocsChatProvider>
  );
}

function ProtoLayoutContent({
  variant,
  liveNav,
  children,
}: {
  variant: VariantId;
  /** The live docs' sidebars; D's docs pages use them when given. */
  liveNav?: LiveNav;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [lastFramework] = useLastFramework();
  const loc = liveLocation(
    locationFromPathname(pathname).location,
    liveNav ? pathname : null,
  );
  const meta = variantMeta(variant);
  const framework = loc?.kind === "framework" ? loc.framework : undefined;

  // Prototype D remembers the last framework so its home points at your docs.
  useEffect(() => {
    if (variant === "d" && framework) rememberFramework(framework);
  }, [variant, framework]);

  if (
    variant === "d" &&
    ((loc?.kind === "docs" && !loc.slug) || loc?.kind === "examples")
  ) {
    return <DHomeLayout>{children}</DHomeLayout>;
  }

  const tree =
    variant === "d" && liveNav
      ? liveTree(liveNav, pathname)
      : buildTree(variant, loc, lastFramework);
  const top = (
    <SidebarTop variant={variant} loc={loc} lastFramework={lastFramework} />
  );
  return (
    <SpaciousLayout
      tree={tree}
      nav={{
        title: <CopilotKitLogo className="h-[22px] w-auto" />,
        url: meta.entry,
      }}
      tabs={layoutTabs(variant) ?? false}
      githubUrl={GITHUB}
      links={[DISCORD, X]}
      slots={{ actions: PanelActions, themeSwitch: AdaptiveThemeSwitch }}
      agent={
        <ProtoStackAgent
          variant={variant}
          framework={framework}
          slug={loc?.kind === "framework" ? loc.slug : undefined}
        />
      }
      searchToggle={{
        components: {
          lg: (
            <div className="flex flex-col gap-2">
              {top}
              <FullSearchTrigger
                hideIfDisabled
                className="h-10 gap-3 rounded-xl bg-card ps-[calc(--spacing(2.5)-1px)] pe-2 shadow-lift hover:bg-accent [&_svg]:shrink-0"
              />
            </div>
          ),
        },
      }}
    >
      {children}
    </SpaciousLayout>
  );
}

/**
 * The live docs' unscoped pages are the built-in agent's, so the stack picker
 * reads them as that framework: switching from `/frontend-tools` to Mastra
 * opens `/mastra/frontend-tools`.
 */
function liveLocation(
  loc: ReturnType<typeof locationFromPathname>["location"],
  pathname: string | null,
) {
  if (loc || !pathname) return loc;
  const path = pathname.split("/").filter(Boolean);
  if (!path.length || path[0] === "reference") return loc;
  const scope = scopeFromPath(path);
  if (scope.framework || scope.prefix) return loc;
  return {
    kind: "framework" as const,
    framework: ROOT_FRAMEWORK,
    slug: path.join("/"),
  };
}
