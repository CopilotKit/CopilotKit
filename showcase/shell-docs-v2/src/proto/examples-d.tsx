"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { IconType } from "react-icons";
import {
  PiArrowsLeftRightDuotone,
  PiBracketsCurlyDuotone,
  PiChatTeardropTextDuotone,
  PiCubeDuotone,
  PiGearSixDuotone,
  PiHandshakeDuotone,
  PiLayoutDuotone,
  PiPaintBrushBroadDuotone,
  PiRocketLaunchDuotone,
  PiStackDuotone,
  PiUsersThreeDuotone,
} from "react-icons/pi";
import { SiGithub } from "react-icons/si";
import {
  ChevronDown,
  ChevronsUpDown,
  RotateCw,
  Search,
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PixelMatrix } from "@/components/brand/pixel-matrix";
import { MATRIX_GROUND } from "@/components/brand/stage";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { frameworkById } from "./data";
import examples from "./examples.json";
import { useLastFramework } from "./last-framework";

type Feature = (typeof examples.features)[number];
type Demo = { route: string; files: string[] };

/** Each showcase category: a sentence-case label and a duotone glyph. */
const CATEGORY: Record<string, { label: string; Icon: IconType }> = {
  "dev-ex": { label: "Starters", Icon: PiRocketLaunchDuotone },
  "chat-ui": { label: "Chat and UI", Icon: PiChatTeardropTextDuotone },
  platform: { label: "Platform", Icon: PiStackDuotone },
  "controlled-generative-ui": {
    label: "Controlled generative UI",
    Icon: PiLayoutDuotone,
  },
  "declarative-generative-ui": {
    label: "Declarative generative UI",
    Icon: PiBracketsCurlyDuotone,
  },
  "open-generative-ui": {
    label: "Open-ended generative UI",
    Icon: PiPaintBrushBroadDuotone,
  },
  "operational-generative-ui": {
    label: "Tool rendering",
    Icon: PiGearSixDuotone,
  },
  interactivity: { label: "Interactivity", Icon: PiHandshakeDuotone },
  "agent-state": { label: "Agent state", Icon: PiArrowsLeftRightDuotone },
  "multi-agent": { label: "Multi-agent", Icon: PiUsersThreeDuotone },
  byoc: { label: "Your own components", Icon: PiCubeDuotone },
};

const demoOf = (f: Feature, fw: string) =>
  (f.demos as Record<string, Demo | undefined>)[fw];
const hostOf = (fw: string) => examples.host.replace("{slug}", fw);
const repoOf = (fw: string) =>
  (examples.repos as Record<string, string>)[fw] ?? "";
const noop = () => () => {};

function Tile({ Icon, size = "md" }: { Icon: IconType; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-secondary text-foreground",
        size === "sm"
          ? "size-7 rounded-lg [&_svg]:size-4"
          : "size-10 rounded-xl [&_svg]:size-5",
      )}
    >
      <Icon />
    </span>
  );
}

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
 * The examples as a playground: features on the left, the real showcase demo
 * running in one app-like window, with the framework and the details in its
 * toolbar.
 */
export function DExamples() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [lastFramework] = useLastFramework();
  const [query, setQuery] = useState("");
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [slow, setSlow] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  // Mount the frame only after hydration, so its load event is never missed.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const feature =
    examples.features.find((f) => f.id === params.get("feature")) ??
    examples.features.find((f) => f.id === "agentic-chat")!;
  const wanted = params.get("framework") ?? lastFramework;
  const framework = feature.frameworks.includes(wanted)
    ? wanted
    : feature.frameworks[0];
  const fw = frameworkById(framework);
  const demo = demoOf(feature, framework)!;
  const src = `${hostOf(framework)}${demo.route}`;
  const frameKey = `${src}#${reloads}`;
  const category = CATEGORY[feature.category];
  const [open, setOpen] = useState<string[]>([feature.category]);

  // A cold demo can take a while; after 12s, offer the new tab.
  useEffect(() => {
    const t = setTimeout(() => setSlow(frameKey), 12000);
    return () => clearTimeout(t);
  }, [frameKey]);

  const go = (next: { feature?: string; framework?: string }) => {
    const q = new URLSearchParams(params);
    if (next.feature) q.set("feature", next.feature);
    if (next.framework) q.set("framework", next.framework);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      examples.categories
        .map((c) => ({
          ...c,
          items: examples.features.filter(
            (f) =>
              f.category === c.id &&
              (!needle ||
                f.name.toLowerCase().includes(needle) ||
                f.description.toLowerCase().includes(needle)),
          ),
        }))
        .filter((g) => g.items.length),
    [needle],
  );

  return (
    // The page ground is the matrix's stage, the same look as every other
    // matrix: it shows in the gutters around the white panels and lights up
    // under the pointer.
    <div className={cn("relative isolate flex-1", MATRIX_GROUND)}>
      <PixelMatrix interactive />
      <div className="mx-auto grid w-full max-w-[96rem] grid-cols-1 gap-4 p-3 md:p-5 lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Features */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-lift">
          <button
            type="button"
            aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}
            className="flex h-12 items-center gap-2.5 px-3 text-start text-sm font-medium lg:hidden"
          >
            <span className="min-w-0 flex-1 truncate">
              Browse all {examples.features.length} examples
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                browsing ? "rotate-0" : "-rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col max-lg:max-h-[24rem] max-lg:border-t",
              !browsing && "max-lg:hidden",
            )}
          >
            <div className="p-2">
              <InputGroup className="h-9 rounded-xl bg-secondary">
                <InputGroupAddon>
                  <Search aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find an example"
                  aria-label="Find an example"
                />
              </InputGroup>
            </div>
            <nav
              aria-label="Examples"
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
            >
              {groups.length ? (
                <Accordion
                  multiple
                  value={needle ? groups.map((g) => g.id) : open}
                  onValueChange={(v) => setOpen(v as string[])}
                >
                  {groups.map((g) => {
                    const meta = CATEGORY[g.id] ?? {
                      label: g.name,
                      Icon: PiCubeDuotone,
                    };
                    return (
                      <AccordionItem
                        key={g.id}
                        value={g.id}
                        className="not-last:border-b-0"
                      >
                        <AccordionTrigger className="items-center gap-2.5 rounded-xl p-1.5 hover:bg-accent hover:no-underline">
                          <span className="flex min-w-0 flex-1 items-center gap-2.5">
                            <Tile Icon={meta.Icon} size="sm" />
                            <span className="truncate">{meta.label}</span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-1.5">
                          <ul className="ms-[1.375rem] mt-0.5 border-s ps-2">
                            {g.items.map((f) => {
                              const on = f.id === feature.id;
                              return (
                                <li key={f.id}>
                                  <button
                                    type="button"
                                    aria-current={on ? "page" : undefined}
                                    title={f.name}
                                    onClick={() => {
                                      setBrowsing(false);
                                      go({ feature: f.id });
                                    }}
                                    className={cn(
                                      "block w-full truncate rounded-lg px-2 py-1.5 text-start text-sm no-underline transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                                      on
                                        ? "bg-primary/10 font-medium text-primary"
                                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                    )}
                                  >
                                    {f.name}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              ) : (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SearchX />
                    </EmptyMedia>
                    <EmptyTitle>No match</EmptyTitle>
                    <EmptyDescription>
                      Nothing is called &ldquo;{query}&rdquo;. Try a feature
                      like &ldquo;chat&rdquo; or &ldquo;state&rdquo;.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </nav>
          </div>
        </aside>

        {/* The demo, in one app window */}
        <section
          aria-label={`${feature.name} on ${fw?.name}`}
          className="flex min-h-[34rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-lift"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5">
            {category ? <Tile Icon={category.Icon} /> : null}
            {/* The showcase's own description of the demo, beside its name. */}
            <div className="flex min-w-[12rem] flex-1 items-baseline gap-2.5">
              <h1 className="shrink-0 text-base font-semibold tracking-[-0.01em]">
                {feature.name}
              </h1>
              <p
                className="min-w-0 truncate text-sm text-muted-foreground"
                title={feature.description}
              >
                {feature.description}
              </p>
            </div>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      aria-label={`Agent framework: ${fw?.name}`}
                      className="me-1 h-11 max-w-56 gap-2 rounded-full ps-2.5 pe-2 sm:h-9"
                    />
                  }
                >
                  <FrameworkLogo
                    slug={framework}
                    size={16}
                    className="shrink-0"
                  />
                  <span className="truncate">{fw?.name}</span>
                  <ChevronsUpDown
                    className="text-muted-foreground"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Agent framework</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={framework}
                    onValueChange={(v) => go({ framework: v as string })}
                  >
                    {feature.frameworks.map((id) => (
                      <DropdownMenuRadioItem
                        key={id}
                        value={id}
                        className="gap-2.5 py-1.5"
                      >
                        <FrameworkLogo
                          slug={id}
                          size={16}
                          className="shrink-0"
                        />
                        {frameworkById(id)?.name ?? id}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <ToolButton
                label="View the code on GitHub"
                href={`${repoOf(framework)}/${demo.files[0] ?? ""}`}
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

          <div className="relative flex-1 bg-white">
            {mounted ? (
              <iframe
                key={frameKey}
                src={src}
                title={`${feature.name} running on ${fw?.name}`}
                onLoad={() => setLoaded(frameKey)}
                allow="clipboard-write; microphone"
                className={cn(
                  "absolute inset-0 size-full border-0 transition-opacity duration-300 motion-reduce:transition-none",
                  loaded === frameKey ? "opacity-100" : "opacity-0",
                )}
              />
            ) : null}
            {loaded !== frameKey ? (
              <div
                className={cn(
                  "absolute inset-0 isolate flex flex-col items-center justify-center gap-3 px-6 text-center",
                  MATRIX_GROUND,
                )}
              >
                {/* The matrix glistens while the demo wakes. */}
                <PixelMatrix glisten />
                <Spinner className="size-6 text-brand-mint-deep" />
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {slow === frameKey ? (
                    <>
                      Still waking up.{" "}
                      <a
                        href={src}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        Open it in a new tab
                      </a>
                    </>
                  ) : (
                    <>Waking up the {fw?.name} demo</>
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
