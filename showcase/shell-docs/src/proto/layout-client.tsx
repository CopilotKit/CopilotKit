"use client";

import { useEffect } from "react";
import type { ComponentProps, ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "fumadocs-core/link";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  AskAIGlyph,
  BackendGlyph,
  CookbookGlyph,
  DirectoryGlyph,
  DeclarativeUIGlyph,
  FrontendToolsGlyph,
  GenerativeUIGlyph,
  HumanInTheLoopGlyph,
  IntelligenceGlyph,
  MCPAppsGlyph,
  OpenGenUIGlyph,
  SharedStateGlyph,
  LearningGlyph,
  MemoryGlyph,
  QuickstartGlyph,
  ReferenceGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import { SiDiscord, SiX } from "react-icons/si";
import { ArrowRight } from "lucide-react";
import type { LinkItemType } from "fumadocs-ui/layouts/shared";
// Spacious' DocsLayout with the CopilotKit "Ask AI" chat in its aiChat slot.
import { DocsLayout as SpaciousLayout } from "@/components/ai/docs-layout";
import { ProtoStackAgent } from "@/components/ai/stack-agents";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import { Button } from "@/components/ui/button";
import { PanelActions } from "@/components/layout/panel-actions";
import { AdaptiveThemeSwitch } from "@/components/layout/theme-toggle";
import { FRAMEWORKS, FRAMEWORK_FAMILIES } from "./data";
import { FamilyMenuCard, IntegrationCardBody } from "./link-card";
import { rememberFramework, useLastFramework } from "./last-framework";
import { useMenuSwitchClick } from "./use-menu-switch-click";
import { frameworkHref, locationFromPathname } from "./routes";
import type { VariantId } from "./routes";
import { SidebarTop, buildTree, layoutTabs } from "./variants";
import { liveTree } from "./live-tree";
import { LivePagesProvider } from "./live-pages-context";
import { trackEvent } from "@/lib/telemetry/analytics";
import { cn } from "@/lib/cn";
import type { LiveNav } from "@/lib/live-nav";
import { ROOT_FRAMEWORK, liveFrontend, scopeFromPath } from "@/lib/live-scope";
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
 * Spacious' `actions` slot with the docs' three sections before the icon
 * links, where docs.copilotkit.ai's top bar has them: Cookbook and Reference
 * are one click from any page and Docs one click back, without taking a row
 * of the sidebar. Cookbook and Reference own their URL prefix; Docs is every
 * other docs page, and opens your framework's quickstart.
 */
function SectionActions({ className, ...props }: ComponentProps<"div">) {
  const path = usePathname().split("/").filter(Boolean);
  const [lastFramework] = useLastFramework();
  const framework = scopeFromPath(path).framework ?? lastFramework;
  const sections = [
    {
      title: "Docs",
      url: frameworkHref("d", framework, "quickstart"),
      active: path[0] !== "cookbook" && path[0] !== "reference",
    },
    { title: "Cookbook", url: "/cookbook", active: path[0] === "cookbook" },
    { title: "Reference", url: "/reference", active: path[0] === "reference" },
  ];
  return (
    <div className={cn("flex items-center gap-1", className)} {...props}>
      <nav aria-label="Docs sections" className="flex items-center">
        {sections.map((s) => (
          <Link
            key={s.title}
            href={s.url}
            aria-current={s.active ? "true" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-7.5 px-2",
              s.active ? "text-fd-primary" : "text-fd-muted-foreground",
            )}
          >
            {s.title}
          </Link>
        ))}
      </nav>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-fd-border" />
      <PanelActions />
    </div>
  );
}

/**
 * Sets a navbar dropdown on the lilac-grey tray: a hidden marker that
 * theme.css finds to recolor Fumadocs' own popup, so it keeps the popup's
 * rounding and resize animation. Hidden, it takes no grid cell.
 */
const MENU_TRAY: Extract<LinkItemType, { type: "custom" }> = {
  type: "custom",
  children: <span data-menu-tray hidden />,
};

/** The Integrations menu's marker: its cards lay out as tiles (theme.css). */
const TILES_TRAY: Extract<LinkItemType, { type: "custom" }> = {
  type: "custom",
  children: <span data-menu-tray data-menu-tiles hidden />,
};

/**
 * A menu card is a white card in the tray, as on the home (link-card.tsx):
 * borderless at rest (theme.css), and on hover it takes the website's lilac
 * border-action edge.
 */
const HOVER =
  "group/card border-transparent transition-[border-color] duration-200 hover:border-edge-action focus-visible:border-ring motion-reduce:transition-none";

/** A card's glyph: solid plum ink with no tile, lilac on hover. */
const INK_GLYPH =
  "text-foreground transition-colors duration-200 group-hover/card:text-primary motion-reduce:transition-none [&_svg]:size-[22px]";

/**
 * Topic cards. Fumadocs draws `banner` above the title in place of its own
 * tiled icon.
 */
function card(icon: ReactNode) {
  return {
    className: HOVER,
    banner: (
      <span aria-hidden="true" className={INK_GLYPH}>
        {icon}
      </span>
    ),
  };
}

/** Integrations cards: tiles, the logo's tile over the name. */
const TILE_CARD = `${HOVER} gap-3 p-3`;

/**
 * The Integrations menu: one card per framework, a family (LangGraph,
 * Strands, ...) as one card whose languages open in a popover, as on the home.
 */
type MenuItem = Extract<LinkItemType, { type: "menu" }>["items"][number];

const INTEGRATIONS_MENU: MenuItem[] = FRAMEWORKS.flatMap((f): MenuItem[] => {
  const family = FRAMEWORK_FAMILIES.find((fam) =>
    fam.variants.some((v) => v.id === f.id),
  );
  if (!family) {
    return [
      {
        text: f.name,
        url: frameworkHref("d", f.id, "quickstart"),
        menu: {
          className: TILE_CARD,
          children: <IntegrationCardBody slug={f.id} name={f.name} />,
        },
      },
    ];
  }
  if (family.variants[0].id !== f.id) return [];
  return [
    {
      type: "custom",
      children: (
        <FamilyMenuCard
          key={family.name}
          name={family.name}
          className={TILE_CARD}
          variants={family.variants.map((v) => ({
            ...v,
            href: frameworkHref("d", v.id, "quickstart"),
          }))}
        />
      ),
    },
  ];
});

/**
 * The Examples menu: a two-row "all demos" tile, then seven demos worth
 * opening first, filling three even columns. Each opens a live showcase demo
 * in the playground (on your framework). Ids are showcase feature ids; the
 * menu shows the ones the playground has (`examples`).
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
];

/** A compact menu card: glyph, title, and a one-line description. */
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
      <span aria-hidden="true" className={INK_GLYPH}>
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

/**
 * The Examples menu's lead tile, two rows tall, on the home's blue stage:
 * the gallery of every demo, its glyph in white.
 */
function GalleryTile() {
  return (
    <>
      <span aria-hidden="true" className="mb-auto text-white [&_svg]:size-6">
        <DirectoryGlyph />
      </span>
      <span className="text-lg leading-6 font-semibold text-white">
        Gallery
      </span>
      <span className="text-sm leading-5 text-white/90">
        Every live demo in one place, running on the framework you use.
      </span>
      <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-white">
        Browse the demos
        <ArrowRight
          aria-hidden="true"
          className="size-4 transition-transform group-hover/all:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </>
  );
}

/** Prototype D's home: Fumadocs' navbar-only Home Layout. */
function DHomeLayout({
  examples,
  children,
}: {
  examples: readonly string[];
  children: ReactNode;
}) {
  const [framework] = useLastFramework();
  const pathname = usePathname();
  useMenuSwitchClick();
  const links: LinkItemType[] = [
    {
      type: "menu",
      text: "Guides",
      items: [
        {
          text: "Quickstart",
          description: "Add a chat to your app and connect it to your agent.",
          url: frameworkHref("d", framework, "quickstart"),
          menu: card(<QuickstartGlyph />),
        },
        {
          text: "Cookbook",
          description: "Recipes for common patterns, start to finish.",
          url: "/cookbook",
          menu: card(<CookbookGlyph />),
        },
        {
          text: "Reference",
          description: "Every hook, component, and runtime API.",
          url: "/reference",
          menu: card(<ReferenceGlyph />),
        },
        MENU_TRAY,
      ],
    },
    {
      type: "menu",
      text: "Integrations",
      items: [...INTEGRATIONS_MENU, TILES_TRAY],
    },
    {
      type: "menu",
      text: "Examples",
      url: "/examples",
      items: [
        {
          text: "Gallery",
          url: "/examples",
          menu: {
            className:
              "group/all row-span-2 gap-1 border-white/60 bg-(image:--stage-captioned) p-4 transition-[border-color] duration-200 hover:border-edge-action motion-reduce:transition-none dark:border-white/10",
            children: <GalleryTile />,
          },
        },
        ...FEATURED_EXAMPLES.filter((e) => examples.includes(e.id)).map(
          (e) => ({
            text: e.title,
            url: `/examples?feature=${e.id}`,
            menu: {
              className: `${HOVER} flex-row items-center gap-3 p-2.5`,
              children: <MenuRow {...e} />,
            },
          }),
        ),
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
          menu: card(i.icon),
        })),
        MENU_TRAY,
      ],
    },
    {
      // The full-page Ask CopilotKit, as a pill beside the search pill.
      type: "custom",
      secondary: true,
      children: (
        <Button
          variant="outline"
          render={<Link href="/ask" />}
          nativeButton={false}
          aria-current={pathname === "/ask" ? "page" : undefined}
          className="h-9 gap-2 rounded-full bg-card px-3.5 shadow-lift aria-[current=page]:hidden [&_svg]:size-4"
        >
          <AskAIGlyph aria-hidden="true" />
          Ask CopilotKit
        </Button>
      ),
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
  variant,
  liveNav,
  examples = [],
  children,
}: {
  variant: VariantId;
  /** The live docs' sidebars; D's docs pages use them when given. */
  liveNav?: LiveNav;
  /** The feature ids the examples playground has, for the Examples menu. */
  examples?: readonly string[];
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

  // The home, the playground, and the full-page Ask CopilotKit take the
  // navbar-only Home Layout.
  if (
    variant === "d" &&
    ((loc?.kind === "docs" && !loc.slug) ||
      loc?.kind === "examples" ||
      pathname === "/ask")
  ) {
    return <DHomeLayout examples={examples}>{children}</DHomeLayout>;
  }

  const tree =
    variant === "d" && liveNav
      ? liveTree(liveNav, pathname)
      : buildTree(variant, loc, lastFramework);
  const top = (
    <SidebarTop variant={variant} loc={loc} lastFramework={lastFramework} />
  );
  return (
    <LivePagesProvider index={liveNav?.index ?? null}>
      <SpaciousLayout
        tree={tree}
        nav={{
          title: <CopilotKitLogo className="h-[22px] w-auto" />,
          url: meta.entry,
        }}
        tabs={layoutTabs(variant) ?? false}
        githubUrl={GITHUB}
        links={[DISCORD, X]}
        slots={{
          actions: variant === "d" && liveNav ? SectionActions : PanelActions,
          themeSwitch: AdaptiveThemeSwitch,
        }}
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
    </LivePagesProvider>
  );
}

/**
 * The live docs' unscoped pages are the built-in agent's, so the stack picker
 * reads them as that framework: switching from `/frontend-tools` to Mastra
 * opens `/mastra/frontend-tools`. A frontend's URL reads as the same page
 * (`/vue/mastra/frontend-tools` as `/mastra/frontend-tools`, `/vue` as the
 * built-in agent's). The reference and cookbook aren't per framework, so they
 * take no stack picker.
 */
function liveLocation(
  loc: ReturnType<typeof locationFromPathname>["location"],
  pathname: string | null,
): ReturnType<typeof locationFromPathname>["location"] {
  if (loc || !pathname) return loc;
  const path = pathname.split("/").filter(Boolean);
  if (liveFrontend(path[0])) {
    const page = `/${path.slice(1).join("/")}`;
    return path.length > 1
      ? liveLocation(locationFromPathname(page).location, page)
      : { kind: "framework", framework: ROOT_FRAMEWORK, slug: "" };
  }
  if (!path.length || path[0] === "reference" || path[0] === "cookbook")
    return loc;
  const scope = scopeFromPath(path);
  if (scope.framework || scope.prefix) return loc;
  return {
    kind: "framework" as const,
    framework: ROOT_FRAMEWORK,
    slug: path.join("/"),
  };
}
