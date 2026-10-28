"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronsUpDown, Info, Search } from "lucide-react";
import { IntelligenceGlyph } from "@/components/icons/glyphs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FRAMEWORKS,
  FRONTENDS,
  frameworkById,
  frontendById,
  LANGUAGES,
  type Framework,
  type FrontendId,
} from "./data";
import { useFrontend } from "./frontend";
import { frameworkHref, type VariantId } from "./routes";

/* ---------- menus ---------- */

function FrameworkList({
  current,
  onPick,
}: {
  current?: string;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      FRAMEWORKS.filter((f) =>
        f.name.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [q],
  );
  return (
    <div className="flex flex-col">
      <label className="sticky top-0 z-10 flex items-center gap-2 border-b bg-fd-popover px-2.5 py-2 text-sm text-fd-muted-foreground">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">Find your agent framework</span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find your agent framework"
          className="min-w-0 flex-1 bg-transparent text-fd-foreground outline-none placeholder:text-fd-muted-foreground"
        />
      </label>
      {LANGUAGES.map((lang) => {
        const items = list.filter((f) => f.language === lang);
        if (!items.length) return null;
        return (
          <div key={lang} className="p-1">
            <p className="px-2 pt-1.5 pb-1 text-xs text-fd-muted-foreground">
              {lang}
            </p>
            {items.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onPick(f.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-accent"
              >
                <FrameworkLogo slug={f.id} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.id === current ? (
                  <Check
                    className="size-4 text-fd-primary"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
          </div>
        );
      })}
      {!list.length ? (
        <p className="px-3 py-3 text-sm text-fd-muted-foreground">
          No match for “{q}”.
        </p>
      ) : null}
    </div>
  );
}

function useFrameworkNav(variant: VariantId, slug: string) {
  const router = useRouter();
  return (id: string) => router.push(frameworkHref(variant, id, slug));
}

/** A framework menu trigger. `look` changes only the trigger. */
export function FrameworkMenu({
  variant,
  current,
  slug,
  look = "tabs-menu",
  label,
  className,
}: {
  variant: VariantId;
  current?: string;
  slug: string;
  look?: "tabs-menu" | "labelled";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const go = useFrameworkNav(variant, slug);
  const fw = current ? frameworkById(current) : undefined;

  const trigger = (
    <PopoverTrigger
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-fd-secondary/50 ps-2.5 pe-2.5 text-start text-sm font-medium transition-colors hover:bg-accent data-[popup-open]:bg-accent",
        look === "labelled" ? "h-11" : "h-10",
      )}
    >
      {fw ? (
        <FrameworkLogo slug={fw.id} size={18} className="shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {fw?.name ?? "Choose a framework"}
      </span>
      <ChevronsUpDown
        className="size-3.5 text-fd-muted-foreground"
        aria-hidden="true"
      />
    </PopoverTrigger>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <p className="px-1 text-xs font-medium text-fd-muted-foreground">
          {label}
        </p>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        <PopoverContent
          align="start"
          sideOffset={6}
          className="max-h-[min(28rem,var(--available-height))] w-72 overflow-y-auto p-0"
        >
          <FrameworkList
            current={current}
            onPick={(id) => {
              setOpen(false);
              go(id);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Frontend dropdown, remembered across pages. */
export function FrontendMenu({
  label,
  look = "sidebar",
}: {
  label?: string;
  look?: "sidebar" | "button";
}) {
  const { frontend, setFrontend } = useFrontend();
  const [open, setOpen] = useState(false);
  const current = frontendById(frontend);
  return (
    <div
      className={look === "button" ? "not-prose flex" : "flex flex-col gap-1.5"}
    >
      {label ? <p className="px-1 text-xs font-semibold">{label}</p> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "flex items-center gap-2.5 rounded-xl border bg-fd-secondary/50 px-2.5 text-start text-sm font-medium transition-colors hover:bg-accent data-[popup-open]:bg-accent",
            look === "sidebar" ? "h-10 w-full" : "h-8 w-fit font-mono text-xs",
          )}
        >
          <FrontendLogo icon={frontend} size={look === "sidebar" ? 18 : 14} />
          <span className="min-w-0 flex-1 truncate">{current?.name}</span>
          <ChevronsUpDown
            className="size-3.5 text-fd-muted-foreground"
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-72 p-1">
          {FRONTENDS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFrontend(f.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-accent"
            >
              <FrontendLogo icon={f.id} size={16} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.id === frontend ? (
                <Check className="size-4 text-fd-primary" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ---------- frontend chips (Storybook) ---------- */

export function FrontendChips({ size = "md" }: { size?: "sm" | "md" }) {
  const { frontend, setFrontend } = useFrontend();
  return (
    <ToggleGroup
      aria-label="Frontend"
      value={[frontend]}
      onValueChange={(v) => {
        if (v[0]) setFrontend(v[0] as FrontendId);
      }}
      variant="outline"
      spacing={1.5}
      // Above the content that follows, so the chips' grown hit area wins.
      className="not-prose relative z-10 flex-wrap"
    >
      {FRONTENDS.map((f) => (
        <ToggleGroupItem
          key={f.id}
          value={f.id}
          className={cn(
            // The ::after strip grows the touch target to 44px tall.
            "relative rounded-full bg-card font-medium text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 hover:bg-accent hover:text-foreground aria-pressed:border-brand-lilac-mid aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-brand-lilac-mid dark:aria-pressed:border-brand-lilac dark:aria-pressed:ring-brand-lilac",
            size === "sm"
              ? "h-7 gap-1.5 px-2.5 text-xs"
              : "h-8 gap-1.5 px-3 text-sm",
          )}
        >
          <FrontendLogo icon={f.id} size={size === "sm" ? 12 : 14} />
          {f.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/* ---------- one sentence (Prisma) ---------- */

export function PlainSentence({
  variant,
  framework,
  slug,
}: {
  variant: VariantId;
  framework: string;
  slug: string;
}) {
  const { frontend, setFrontend } = useFrontend();
  const other = FRONTENDS.find((f) => f.id !== frontend)!;
  const fw = frameworkById(framework);
  const alt = FRAMEWORKS.find((f) => f.id !== framework && f.popular)!;
  return (
    <p className="not-prose text-sm text-fd-muted-foreground">
      This page uses{" "}
      <span className="font-medium text-fd-foreground">
        {frontendById(frontend)?.name}
      </span>{" "}
      and <span className="font-medium text-fd-foreground">{fw?.name}</span>.{" "}
      <button
        type="button"
        onClick={() => setFrontend(other.id)}
        className="font-medium text-fd-primary underline-offset-4 hover:underline"
      >
        Use {other.name} instead
      </button>{" "}
      ·{" "}
      <Link
        href={frameworkHref(variant, alt.id, slug)}
        className="font-medium text-fd-primary underline-offset-4 hover:underline"
      >
        Use {alt.short}
      </Link>
    </p>
  );
}

/* ---------- dead end (Sentry) ---------- */

export function FrameworkChooser({
  variant,
  slug,
}: {
  variant: VariantId;
  slug: string;
}) {
  return (
    <div className="not-prose flex flex-col gap-4">
      <div className="flex gap-2.5 rounded-xl border border-fd-primary/30 bg-fd-primary/5 p-4 text-sm">
        <Info
          className="mt-0.5 size-4 shrink-0 text-fd-primary"
          aria-hidden="true"
        />
        <p>
          This page is written for each agent framework. Pick yours and
          we&apos;ll take you to its version.
        </p>
      </div>
      {LANGUAGES.map((lang) => (
        <div key={lang} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{lang}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FRAMEWORKS.filter((f) => f.language === lang).map((f) => (
              <Link
                key={f.id}
                href={frameworkHref(variant, f.id, slug)}
                className="flex items-center gap-2.5 rounded-xl border bg-fd-card px-3 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                <FrameworkLogo slug={f.id} size={18} />
                <span className="flex-1">{f.name}</span>
                <ArrowRight
                  className="size-4 text-fd-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- available-for tiles (Clerk) ---------- */

export function AvailableTiles({
  variant,
  framework,
  slug,
}: {
  variant: VariantId;
  framework: string;
  slug: string;
}) {
  const tiles = FRAMEWORKS.map((f) => (
    <Link
      key={f.id}
      href={frameworkHref(variant, f.id, slug)}
      title={f.name}
      aria-label={`${f.name}${f.id === framework ? " (current)" : ""}`}
      aria-current={f.id === framework ? "page" : undefined}
      className={cn(
        "flex aspect-square items-center justify-center rounded-lg border bg-fd-background transition",
        f.id === framework
          ? "ring-2 ring-fd-primary/60"
          : "opacity-55 grayscale hover:opacity-100 hover:grayscale-0",
      )}
    >
      <FrameworkLogo slug={f.id} size={18} />
    </Link>
  ));
  return (
    <div className="not-prose flex flex-col gap-2 rounded-xl bg-fd-muted p-2.5">
      <p className="text-xs font-medium">Available for</p>
      <div className="grid grid-cols-4 gap-1.5">{tiles}</div>
    </div>
  );
}

/* ---------- directory (AI SDK) ---------- */

function CapChips({ fw, max = 99 }: { fw: Framework; max?: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      {fw.caps.slice(0, max).map((c) => (
        <span
          key={c}
          className="rounded-md border bg-fd-background px-1.5 py-0.5 text-xs text-fd-muted-foreground"
        >
          {c}
        </span>
      ))}
    </span>
  );
}

export function DirectoryCards({ variant }: { variant: VariantId }) {
  return (
    <div className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FRAMEWORKS.map((f) => (
        <Link
          key={f.id}
          href={frameworkHref(variant, f.id)}
          className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-fd-card p-4 transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border bg-fd-background">
              <FrameworkLogo slug={f.id} size={22} />
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{f.name}</span>
              <span className="text-xs text-fd-muted-foreground">
                {f.language} · {f.demos} live demos
              </span>
            </span>
            <ArrowRight
              className="ms-auto size-4 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
          <CapChips fw={f} max={4} />
        </Link>
      ))}
    </div>
  );
}

/* ---------- partner page header ---------- */

export function PartnerHeader({
  variant,
  framework,
}: {
  variant: VariantId;
  framework: string;
}) {
  const fw = frameworkById(framework)!;
  return (
    <section className="not-prose flex flex-col gap-5 rounded-3xl border bg-fd-card p-6">
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-2xl border bg-fd-background shadow-sm">
          <FrameworkLogo slug={fw.id} size={30} />
        </span>
        <div>
          <p className="text-sm text-fd-muted-foreground">CopilotKit for</p>
          <p className="text-3xl leading-tight font-semibold tracking-[-0.025em]">
            {fw.name}
          </p>
        </div>
      </div>
      <p className="max-w-[36rem] text-fd-muted-foreground">
        Give your {fw.name} agent a frontend: chat, generative UI, shared state,
        and human approvals, with {fw.demos} live demos to start from.
      </p>
      <CapChips fw={fw} />
      <div className="flex flex-wrap gap-2">
        <Link
          href={frameworkHref(variant, fw.id, "quickstart")}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-fd-foreground px-4 text-sm font-medium text-fd-background hover:opacity-85"
        >
          Quickstart
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <span className="inline-flex h-10 items-center rounded-full border px-4 text-sm text-fd-muted-foreground">
          {fw.language}
        </span>
      </div>
    </section>
  );
}

/* ---------- two questions (Expo) ---------- */

export function TwoQuestions({
  variant,
  framework,
}: {
  variant: VariantId;
  framework?: string;
}) {
  const { frontend, setFrontend } = useFrontend();
  const router = useRouter();
  return (
    <div className="not-prose flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-xl font-semibold tracking-[-0.01em]">
          What are you building with?
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FRONTENDS.map((f) => {
            const on = f.id === frontend;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFrontend(f.id as FrontendId)}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-2xl border bg-fd-card px-3 py-5 text-start transition-colors",
                  on
                    ? "border-fd-primary/60 bg-fd-primary/5"
                    : "hover:bg-accent",
                )}
              >
                <FrontendLogo icon={f.id} size={34} />
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={cn(
                      "size-3.5 rounded-full border",
                      on && "border-[5px] border-fd-primary",
                    )}
                  />
                  {f.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-xl font-semibold tracking-[-0.01em]">
          Which agent framework?
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FRAMEWORKS.filter((f) => f.popular || f.id === framework).map(
            (f) => {
              const on = f.id === framework;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() =>
                    router.push(frameworkHref(variant, f.id, "quickstart"))
                  }
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border bg-fd-card px-3 py-2.5 text-start text-sm transition-colors",
                    on
                      ? "border-fd-primary/60 bg-fd-primary/5"
                      : "hover:bg-accent",
                  )}
                >
                  <FrameworkLogo slug={f.id} size={18} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.name}
                  </span>
                  {on ? (
                    <Check
                      className="size-4 text-fd-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            },
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- quickstart cards (Supabase) ---------- */

export function QuickstartCards({ variant }: { variant: VariantId }) {
  return (
    <div className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-3">
      {FRAMEWORKS.map((f) => (
        <Link
          key={f.id}
          href={frameworkHref(variant, f.id, "quickstart")}
          className="flex flex-col gap-2 rounded-2xl border bg-fd-card p-4 transition-colors hover:bg-accent"
        >
          <FrameworkLogo slug={f.id} size={22} />
          <span className="font-semibold">{f.name}</span>
          <span className="text-sm text-fd-muted-foreground">
            A chat app on a {f.short} agent, in a few minutes.
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ---------- Intelligence, spliced into the docs ---------- */

export function IntelligenceCallout({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="not-prose my-6 flex items-start gap-3 rounded-2xl border bg-fd-card p-4 transition-colors hover:bg-accent"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary">
        <IntelligenceGlyph className="size-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">
          With CopilotKit Intelligence
        </span>
        <span className="text-sm text-fd-muted-foreground">{children}</span>
      </span>
      <ArrowRight
        className="ms-auto mt-2 size-4 shrink-0 text-fd-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

/* ---------- the docs' two-row stack picker (prototype D) ---------- */

function StackRow({
  label,
  value,
  icon,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-2 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-fd-ring data-[popup-open]:bg-accent">
        <span className="flex size-5 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-fd-muted-foreground">{label}</span>
          <span className="truncate font-medium">{value}</span>
        </span>
        <ChevronsUpDown
          className="size-3.5 shrink-0 text-fd-muted-foreground"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={14}
        className="flex max-h-[min(30rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-0 overflow-y-auto rounded-xl p-0 ring-frame-rim"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Frontend and agent framework as two rows, like the current docs sidebar.
 * The frontend switches in place; the framework changes the URL and keeps
 * your page.
 */
export function StackRows({
  variant,
  framework,
  slug,
  onFramework,
}: {
  variant: VariantId;
  framework: string;
  slug: string;
  /** Replaces navigating to the same page under the new framework. */
  onFramework?: (id: string) => void;
}) {
  const { frontend, setFrontend } = useFrontend();
  const [open, setOpen] = useState<"frontend" | "framework" | null>(null);
  const nav = useFrameworkNav(variant, slug);
  const go = onFramework ?? nav;
  const fw = frameworkById(framework);
  return (
    // The website's white container and soft lift set the stack apart from the
    // sidebar's grey ground.
    <div className="flex flex-col rounded-xl border bg-card p-1 text-sm shadow-lift">
      <StackRow
        label="Frontend"
        value={frontendById(frontend)?.name ?? ""}
        icon={<FrontendLogo icon={frontend} size={18} />}
        open={open === "frontend"}
        onOpenChange={(o) => setOpen(o ? "frontend" : null)}
      >
        {(["app", "channel"] as const).map((kind) => (
          <div key={kind} className="p-1">
            <p className="px-2 pt-1.5 pb-1 text-xs text-fd-muted-foreground">
              {kind === "app" ? "Frontends" : "Channels"}
            </p>
            {FRONTENDS.filter((f) => f.kind === kind).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFrontend(f.id);
                  setOpen(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-accent"
              >
                <FrontendLogo icon={f.id} size={16} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.id === frontend ? (
                  <Check
                    className="size-4 text-fd-primary"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </StackRow>
      <div className="mx-2 my-0.5 border-t" />
      <StackRow
        label="Agent framework"
        value={fw?.name ?? ""}
        icon={<FrameworkLogo slug={framework} size={18} />}
        open={open === "framework"}
        onOpenChange={(o) => setOpen(o ? "framework" : null)}
      >
        <FrameworkList
          current={framework}
          onPick={(id) => {
            setOpen(null);
            go(id);
          }}
        />
      </StackRow>
    </div>
  );
}
