"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { IconType } from "react-icons";
import {
  PiChatTeardropTextFill,
  PiCubeFill,
  PiHandshakeFill,
  PiRocketLaunchFill,
  PiUsersThreeFill,
} from "react-icons/pi";
import { SiGithub } from "react-icons/si";
import { ChevronDown, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DeclarativeUIGlyph,
  GenerativeUIGlyph,
  OpenGenUIGlyph,
  SharedStateGlyph,
  StackGlyph,
  ToolRenderingGlyph,
} from "@/components/icons/glyphs";
import { DemoSkeleton } from "@/components/demo-skeleton";
import { FrameworkPicker } from "@/components/framework-picker";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSiteHosts } from "@/components/site-hosts";
import { frameworkById } from "./data";
import {
  EXAMPLES,
  EXAMPLE_CATEGORIES,
  demoSourceUrl,
  demoUrl,
} from "./examples";
import { useLastFramework } from "./last-framework";

/**
 * Each showcase category: a sentence-case label and a solid glyph, the
 * site's own where it has one (glyphs.tsx), drawn as a sidebar section
 * heading like the docs' own.
 */
const CATEGORY: Record<string, { label: string; Icon: IconType }> = {
  "dev-ex": { label: "Starters", Icon: PiRocketLaunchFill },
  "chat-ui": { label: "Chat and UI", Icon: PiChatTeardropTextFill },
  platform: { label: "Platform", Icon: StackGlyph },
  "controlled-generative-ui": {
    label: "Controlled generative UI",
    Icon: GenerativeUIGlyph,
  },
  "declarative-generative-ui": {
    label: "Declarative generative UI",
    Icon: DeclarativeUIGlyph,
  },
  "open-generative-ui": {
    label: "Open-ended generative UI",
    Icon: OpenGenUIGlyph,
  },
  "operational-generative-ui": {
    label: "Tool rendering",
    Icon: ToolRenderingGlyph,
  },
  interactivity: { label: "Interactivity", Icon: PiHandshakeFill },
  "agent-state": { label: "Agent state", Icon: SharedStateGlyph },
  "multi-agent": { label: "Multi-agent", Icon: PiUsersThreeFill },
  byoc: { label: "Your own components", Icon: PiCubeFill },
};

const noop = () => () => {};

/** The examples by category, in the showcase's order. */
const GROUPS = EXAMPLE_CATEGORIES.map((c) => ({
  ...c,
  items: EXAMPLES.filter((f) => f.category === c.id),
})).filter((g) => g.items.length);

/** An icon button with a tooltip; links render as anchors. */
function ToolButton({
  label,
  href,
  onClick,
  children,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={label}
            onClick={onClick}
            className="size-11 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground sm:size-9"
            {...(href
              ? {
                  render: (
                    <a href={href} target="_blank" rel="noreferrer noopener" />
                  ),
                  nativeButton: false,
                }
              : {})}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The examples as a playground, laid out like the docs: the examples as a
 * sidebar on the frame, and the real showcase demo running in the white page
 * panel, with the framework picker and the tools in its header.
 */
export function ExamplesPlayground() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [lastFramework] = useLastFramework();
  const hosts = useSiteHosts();
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [slow, setSlow] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  // Mount the frame only after hydration, so its load event is never missed.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const feature =
    EXAMPLES.find((f) => f.id === params.get("feature")) ??
    EXAMPLES.find((f) => f.id === "agentic-chat") ??
    EXAMPLES[0];
  const wanted = params.get("framework") ?? lastFramework;
  const framework = feature.frameworks.includes(wanted)
    ? wanted
    : feature.frameworks[0];
  const fwName = frameworkById(framework)?.name ?? framework;
  const demo = feature.demos[framework];
  const src = demoUrl(hosts, framework, demo);
  const frameKey = `${src}#${reloads}`;

  // A cold demo can take a while; after 12s, offer the new tab.
  useEffect(() => {
    const t = setTimeout(() => setSlow(frameKey), 12000);
    return () => clearTimeout(t);
  }, [frameKey]);

  // Like the docs' sidebar, bring the current example into view.
  useEffect(() => {
    const nav = navRef.current;
    const row = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !row) return;
    const top = row.offsetTop;
    if (
      top < nav.scrollTop ||
      top + row.offsetHeight > nav.scrollTop + nav.clientHeight
    ) {
      nav.scrollTop = top - nav.clientHeight / 3;
    }
  }, [feature.id]);

  const go = (next: { feature?: string; framework?: string }) => {
    const q = new URLSearchParams(params);
    if (next.feature) q.set("feature", next.feature);
    if (next.framework) q.set("framework", next.framework);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    // Spacious' geometry: the frame holds the sidebar and an 8px ring around
    // the white page panel.
    <div className="flex flex-1 flex-col bg-frame lg:h-[calc(100dvh-3.5rem)] lg:flex-none lg:flex-row">
      {/* The examples, as the docs' sidebar */}
      <aside className="flex min-h-0 flex-col text-sm lg:w-[268px] lg:shrink-0">
        <div className="px-2 pt-2 lg:hidden">
          <button
            type="button"
            aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}
            className="flex h-11 w-full items-center gap-2.5 rounded-xl bg-card px-3 text-start font-medium shadow-lift"
          >
            <span className="min-w-0 flex-1 truncate">
              Browse all {EXAMPLES.length} examples
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                browsing ? "rotate-0" : "-rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        </div>
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col max-lg:max-h-[28rem]",
            !browsing && "max-lg:hidden",
          )}
        >
          <nav
            ref={navRef}
            aria-label="Examples"
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-4 pb-8 mask-t-from-[calc(100%-16px)] mask-b-from-[calc(100%-32px)]"
          >
            {GROUPS.map((g) => {
              const meta = CATEGORY[g.id] ?? {
                label: g.name,
                Icon: PiCubeFill,
              };
              return (
                <section key={g.id} className="not-first:mt-6">
                  <h2 className="mb-1.5 flex items-center gap-2 px-2.5 text-xs font-medium text-sidebar-primary">
                    <meta.Icon
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    {meta.label}
                  </h2>
                  <ul>
                    {g.items.map((f) => {
                      const on = f.id === feature.id;
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            aria-current={on ? "page" : undefined}
                            onClick={() => {
                              setBrowsing(false);
                              go({ feature: f.id });
                            }}
                            className={cn(
                              "flex w-full items-center rounded-lg px-2.5 py-2 text-start wrap-anywhere outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                              on
                                ? "bg-sidebar-primary/10 text-sidebar-primary"
                                : "text-frame-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                            )}
                          >
                            {f.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* The demo, in the page panel */}
      <section
        aria-label={`${feature.name} on ${fwName}`}
        className="m-2 flex min-h-[34rem] flex-1 flex-col overflow-clip rounded-2xl border bg-background shadow-sm lg:ms-0 lg:min-h-0"
      >
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2.5 ps-6 pe-3 max-sm:ps-4">
          <h1 className="min-w-[12rem] flex-1 truncate text-base font-semibold tracking-[-0.01em]">
            {feature.name}
          </h1>

          <div className="flex items-center gap-1">
            <FrameworkPicker
              value={framework}
              frameworks={feature.frameworks}
              onValueChange={(id) => go({ framework: id })}
              align="end"
              className="me-1 h-11 max-w-56 sm:h-9"
            />
            <ToolButton
              label="View the code on GitHub"
              href={demoSourceUrl(framework, demo)}
            >
              <SiGithub />
            </ToolButton>
            <ToolButton
              label="Reload the demo"
              onClick={() => {
                setLoaded(null);
                setReloads((n) => n + 1);
              }}
            >
              <RotateCw />
            </ToolButton>
          </div>
        </header>

        <div className="relative flex-1 bg-background">
          {mounted ? (
            <iframe
              key={frameKey}
              src={src}
              title={`${feature.name} running on ${fwName}`}
              onLoad={() => setLoaded(frameKey)}
              allow="clipboard-write; microphone"
              className={cn(
                "absolute inset-0 size-full border-0 transition-opacity duration-300 motion-reduce:transition-none",
                loaded === frameKey ? "opacity-100" : "opacity-0",
              )}
            />
          ) : null}
          {loaded !== frameKey ? (
            <DemoSkeleton
              src={src}
              slow={slow === frameKey}
              name={`the ${fwName} demo`}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}
